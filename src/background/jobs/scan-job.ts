import type { PhotosAdapter } from '@/adapter/types';
import type { Repo } from '@/storage/repo';
import type { Analyzer } from '../offscreen-client';
import type { ItemAnalysis, ItemEmbedding, Job, MediaItem, ScanCursor, Settings } from '@/shared/types';
import { clusterAll } from '@/ml/cluster';
import { summarize } from '@/ml/summary';
import { quantize } from '@/ml/similarity';
import { getModel } from '@/ml/embedding/model-registry';
import { logger } from '@/shared/log';

const log = logger('scan');

export interface ScanDeps {
  adapter: PhotosAdapter;
  repo: Repo;
  analyzer: Analyzer;
  settings: Settings;
  /** Called after each step so the UI can show progress. */
  onProgress?: (job: Job) => void;
  /** Returns true if the job should stop after the current step. */
  shouldStop?: () => boolean;
  now?: () => number;
  /** Thumbnail URL rewrite for a given pixel size (adapter specific). */
  thumbFor?: (base: string, size: number) => string;
  batch?: { analyze: number; embed: number; sizes: number };
}

/**
 * Resumable scan pipeline. Each phase persists its cursor so a killed service
 * worker or a paused job can continue where it left off.
 *
 *  enumerate -> sizes -> hash -> embed -> cluster -> done
 */
export async function runScan(job: Job, deps: ScanDeps): Promise<Job> {
  const now = deps.now ?? Date.now;
  const batch = deps.batch ?? { analyze: 48, embed: 16, sizes: 400 };
  const thumbFor = deps.thumbFor ?? ((base) => base);
  let cursor: ScanCursor = job.cursor ?? { phase: 'enumerate', pageId: null, processed: 0, total: null };

  const save = async (patch: Partial<Job> = {}) => {
    job = { ...job, ...patch, cursor, updatedAt: now() };
    await deps.repo.putJob(job);
    deps.onProgress?.(job);
    return job;
  };
  const stopRequested = () => deps.shouldStop?.() === true;

  await save({ state: 'running' });

  try {
    if (cursor.phase === 'enumerate') {
      do {
        const page = await deps.adapter.listItems(cursor.pageId);
        await deps.repo.upsertListedItems(page.items);
        cursor = { ...cursor, pageId: page.nextPageId, processed: cursor.processed + page.items.length };
        job.counts.enumerated = cursor.processed;
        await save();
        if (stopRequested()) return save({ state: 'paused' });
      } while (cursor.pageId !== null);
      // Mark favorites (protected) in a second pass; cheap and keeps listItems simple.
      let favPage: string | null = null;
      do {
        const page = await deps.adapter.listFavorites(favPage);
        await deps.repo.patchItems(page.items.map((i) => ({ mediaKey: i.mediaKey, isFavorite: true, protected: true })));
        favPage = page.nextPageId;
      } while (favPage !== null);
      cursor = { phase: 'sizes', pageId: null, processed: 0, total: null };
      await save();
    }

    if (cursor.phase === 'sizes') {
      const missing = await deps.repo.itemsMissingSize();
      cursor = { ...cursor, total: missing.length };
      for (let i = 0; i < missing.length; i += batch.sizes) {
        const chunk = missing.slice(i, i + batch.sizes);
        const infos = await deps.adapter.getMediaInfo(chunk.map((m) => m.mediaKey));
        await deps.repo.patchItems(
          infos.map((inf) => ({
            mediaKey: inf.mediaKey,
            sizeBytes: inf.sizeBytes,
            takesUpSpace: inf.takesUpSpace,
            spaceTakenBytes: inf.spaceTakenBytes,
            fileName: inf.fileName,
            uploadedAt: inf.uploadedAt,
          })),
        );
        cursor = { ...cursor, processed: Math.min(missing.length, i + chunk.length) };
        job.counts.sized = cursor.processed;
        await save();
        if (stopRequested()) return save({ state: 'paused' });
      }
      cursor = { phase: 'hash', pageId: null, processed: 0, total: null };
      await save();
    }

    if (cursor.phase === 'hash') {
      const items = (await deps.repo.itemsByStatus('cloud')).filter((i) => i.durationMs === null);
      const done = await deps.repo.allAnalyses();
      const todo = items.filter((i) => !done.has(i.mediaKey));
      cursor = { ...cursor, total: todo.length };
      for (let i = 0; i < todo.length; i += batch.analyze) {
        const chunk = todo.slice(i, i + batch.analyze);
        const results = await deps.analyzer.analyze(chunk.map((it) => ({ mediaKey: it.mediaKey, thumbUrl: thumbFor(it.thumbUrl, 128) })));
        const rows: ItemAnalysis[] = results.map((r) => ({
          mediaKey: r.mediaKey,
          phash: r.phash,
          dhash: r.dhash,
          sharpness: r.sharpness,
          luminance: r.luminance,
          analyzedAt: now(),
        }));
        await deps.repo.putAnalyses(rows);
        job.counts.hashFailures = (job.counts.hashFailures ?? 0) + results.filter((r) => r.error).length;
        cursor = { ...cursor, processed: Math.min(todo.length, i + chunk.length) };
        job.counts.hashed = cursor.processed;
        await save();
        if (stopRequested()) return save({ state: 'paused' });
      }
      cursor = { phase: 'embed', pageId: null, processed: 0, total: null };
      await save();
    }

    if (cursor.phase === 'embed') {
      const modelId = deps.settings.embeddingModelId;
      const spec = getModel(modelId);
      const items = (await deps.repo.itemsByStatus('cloud')).filter((i) => i.durationMs === null);
      const have = await deps.repo.embeddingsForModel(modelId);
      // Only embed items that have a neighbour inside the time window: that is
      // where "similar shots" can exist, and it cuts work by an order of magnitude.
      const candidates = itemsWithTimeNeighbours(items, deps.settings.similarTimeWindowMin * 60_000).filter((i) => !have.has(i.mediaKey));
      cursor = { ...cursor, total: candidates.length };
      for (let i = 0; i < candidates.length; i += batch.embed) {
        const chunk = candidates.slice(i, i + batch.embed);
        let results;
        try {
          results = await deps.analyzer.embed(modelId, chunk.map((it) => ({ mediaKey: it.mediaKey, thumbUrl: thumbFor(it.thumbUrl, spec.inputSize) })));
        } catch (e) {
          // The model could not load (offline, blocked, out of memory). Exact
          // duplicates do not need it, so finish the scan without the similar
          // pass instead of failing, and tell the user why.
          log.warn('embedding unavailable, skipping similar-shot pass', e);
          job.counts.similarSkipped = 1;
          job.warning = `Similar-shot detection was skipped because the on-device AI model could not be loaded (${e instanceof Error ? e.message : String(e)}). Exact duplicates were still checked.`;
          break;
        }
        const rows: ItemEmbedding[] = [];
        for (const r of results) {
          if (!r.vector) {
            job.counts.embedFailures = (job.counts.embedFailures ?? 0) + 1;
            continue;
          }
          rows.push({ mediaKey: r.mediaKey, modelId: spec.id, dim: r.vector.length, q: quantize(Float32Array.from(r.vector)) });
        }
        await deps.repo.putEmbeddings(rows);
        cursor = { ...cursor, processed: Math.min(candidates.length, i + chunk.length) };
        job.counts.embedded = cursor.processed;
        await save();
        if (stopRequested()) return save({ state: 'paused' });
      }
      cursor = { phase: 'cluster', pageId: null, processed: 0, total: null };
      await save();
    }

    if (cursor.phase === 'cluster') {
      const items = await deps.repo.allItems();
      const analyses = await deps.repo.allAnalyses();
      const embeddings = await deps.repo.embeddingsForModel(deps.settings.embeddingModelId);
      const groups = clusterAll(
        { items, analyses, embeddings },
        {
          duplicateHammingMax: deps.settings.duplicateHammingMax,
          similarThreshold: deps.settings.similarThreshold,
          similarTimeWindowMs: deps.settings.similarTimeWindowMin * 60_000,
          now,
        },
      );
      await deps.repo.replaceGroups(groups);
      const summary = summarize(groups, items, deps.settings.largeVideoMinBytes, now());
      await deps.repo.setKv('reclaimable', summary);
      await deps.repo.setKv('lastScanAt', now());
      try {
        await deps.repo.setKv('usage', await deps.adapter.getStorageUsage());
      } catch (e) {
        log.warn('storage usage unavailable', e);
      }
      job.counts.groups = groups.length;
      cursor = { phase: 'done', pageId: null, processed: 0, total: null };
    }

    return save({ state: 'done', finishedAt: now() });
  } catch (e) {
    log.error('scan failed', e);
    return save({ state: 'failed', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Items that have at least one other still within `windowMs` of them. */
export function itemsWithTimeNeighbours(items: MediaItem[], windowMs: number): MediaItem[] {
  const sorted = [...items].sort((a, b) => a.takenAt - b.takenAt);
  const keep = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.takenAt - a.takenAt > windowMs) break;
      keep.add(a.mediaKey);
      keep.add(b.mediaKey);
    }
  }
  return sorted.filter((i) => keep.has(i.mediaKey));
}

export function newScanJob(id: string, now = Date.now()): Job {
  return { id, type: 'scan', state: 'queued', cursor: null, startedAt: now, updatedAt: now, finishedAt: null, error: null, counts: {} };
}
