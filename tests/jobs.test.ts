import { beforeEach, describe, expect, it } from 'vitest';
import { MockAdapter } from '@/adapter/mock/mock-adapter';
import { newScanJob, runScan, itemsWithTimeNeighbours } from '@/background/jobs/scan-job';
import { planClean, runClean } from '@/background/jobs/clean-job';
import type { Analyzer } from '@/background/offscreen-client';
import { DEFAULT_SETTINGS, type Job } from '@/shared/types';
import { phash, dhash } from '@/ml/phash';
import type { Repo } from '@/storage/repo';
import { freshRepo, synthImage } from './helpers';

/**
 * Fake analyzer: derives hashes and embeddings from the mock scene name, the
 * same way the offscreen synthetic thumbnails do, so the pipeline can run in
 * Node without a canvas or a model.
 */
function seedOf(url: string) {
  const scene = url.replace(/^mock:\/\/thumb\//, '').replace(/=.*$/, '');
  const m = /^(.*?)(?:-v(\d+))?$/.exec(scene)!;
  let seed = 0;
  for (const ch of m[1]!) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return { seed, variant: Number(m[2] ?? 0) };
}
const fakeAnalyzer: Analyzer = {
  analyze: async (items) =>
    items.map(({ mediaKey, thumbUrl }) => {
      const { seed, variant } = seedOf(thumbUrl);
      const img = synthImage(seed, 96, 72, variant * 2);
      return { mediaKey, phash: phash(img), dhash: dhash(img), sharpness: 100 - variant, luminance: 120 };
    }),
  embed: async (_m, items) =>
    items.map(({ mediaKey, thumbUrl }) => {
      const { seed, variant } = seedOf(thumbUrl);
      const v = Array.from({ length: 8 }, (_, i) => Math.sin(seed * (i + 1)) + variant * 0.02 * (i % 2));
      return { mediaKey, vector: v };
    }),
  modelStatus: async (modelId) => ({ modelId, state: 'ready', device: 'wasm', progress: 1 }),
};

const settings = { ...DEFAULT_SETTINGS, similarThreshold: 0.98, embeddingModelId: 'dinov2-base' };

let repo: Repo;
beforeEach(async () => {
  repo = await freshRepo();
});

describe('scan job', () => {
  it('runs the full pipeline over the fixture library', async () => {
    const adapter = new MockAdapter();
    const job = await runScan(newScanJob('s1', 0), { adapter, repo, analyzer: fakeAnalyzer, settings });
    expect(job.state).toBe('done');
    expect(job.counts.enumerated).toBe(16);

    const items = await repo.allItems();
    expect(items.every((i) => i.sizeBytes !== null)).toBe(true);
    expect((await repo.getItem('dup-a1'))!.protected).toBe(true);

    const groups = await repo.allGroups();
    const dupIds = groups.filter((g) => g.kind === 'duplicate').map((g) => g.itemIds.join(','));
    expect(dupIds).toEqual(expect.arrayContaining(['dup-a1,dup-a2', 'dup-b1,dup-b2']));

    const burst = groups.find((g) => g.kind === 'similar' && g.itemIds.includes('burst-1'));
    expect(burst?.itemIds).toEqual(['burst-1', 'burst-2', 'burst-3', 'burst-4', 'burst-5']);
    // "far-1" is the same scene a day later: never grouped as similar.
    expect(groups.some((g) => g.kind === 'similar' && g.itemIds.includes('far-1'))).toBe(false);

    const summary = (await repo.getKv('reclaimable'))!;
    // dup-a: keep the favorite, reclaim the copy. dup-b: the copy takes no space.
    const dupA = groups.find((g) => g.itemIds.includes('dup-a1'))!;
    expect(dupA.keepId).toBe('dup-a1');
    expect(groups.find((g) => g.itemIds.includes('dup-b1'))!.reclaimableBytes).toBe(0);
    expect(summary.largeVideosBytes).toBe(812_000_000);
  });

  it('pauses and resumes from the stored cursor', async () => {
    const adapter = new MockAdapter({ pageSize: 4 });
    let calls = 0;
    const paused = await runScan(newScanJob('s2', 0), { adapter, repo, analyzer: fakeAnalyzer, settings, shouldStop: () => ++calls === 2 });
    expect(paused.state).toBe('paused');
    expect(paused.cursor!.phase).toBe('enumerate');
    const done = await runScan(paused, { adapter, repo, analyzer: fakeAnalyzer, settings });
    expect(done.state).toBe('done');
    expect(await repo.countItems()).toBe(16);
  });

  it('fails cleanly and keeps the cursor when the adapter breaks', async () => {
    const adapter = new MockAdapter({ failEvery: 2 });
    const job = await runScan(newScanJob('s3', 0), { adapter, repo, analyzer: fakeAnalyzer, settings });
    expect(job.state).toBe('failed');
    expect(job.error).toMatch(/mock failure/);
    expect(job.cursor).not.toBeNull();
  });

  it('only embeds items with a neighbour in the time window', () => {
    const mk = (k: string, t: number) => ({ mediaKey: k, takenAt: t }) as never;
    const out = itemsWithTimeNeighbours([mk('a', 0), mk('b', 1000), mk('c', 10_000_000)], 60_000);
    expect(out.map((i: { mediaKey: string }) => i.mediaKey)).toEqual(['a', 'b']);
  });
});

describe('clean job', () => {
  async function scanned() {
    const adapter = new MockAdapter();
    await runScan(newScanJob('s', 0), { adapter, repo, analyzer: fakeAnalyzer, settings });
    return adapter;
  }
  const cleanJob = (): Job => ({ id: 'c1', type: 'clean', state: 'queued', cursor: null, startedAt: 0, updatedAt: 0, finishedAt: null, error: null, counts: {} });

  it('dry run trashes nothing and logs the plan', async () => {
    const adapter = await scanned();
    const groups = await repo.allGroups();
    const job = await runClean(cleanJob(), groups, { adapter, repo, dryRun: true });
    expect(job.state).toBe('done');
    expect(adapter.trashCalls).toHaveLength(0);
    expect(job.counts.planned).toBeGreaterThan(0);
    const log = await repo.recentAudit();
    expect(log[0]!.dryRun).toBe(true);
  });

  it('never trashes favorites, even when the user marks them', async () => {
    const adapter = await scanned();
    const g = (await repo.allGroups()).find((x) => x.itemIds.includes('dup-a1'))!;
    const forced = { ...g, decisions: { 'dup-a1': 'trash' as const, 'dup-a2': 'keep' as const } };
    const plan = await planClean([forced], repo);
    expect(plan.toTrash.map((i) => i.mediaKey)).not.toContain('dup-a1');
    expect(plan.skipped.find((s) => s.item.mediaKey === 'dup-a1')?.reason).toMatch(/favorite/);
    await runClean(cleanJob(), [forced], { adapter, repo, dryRun: false, sleep: async () => {} });
    expect(adapter.statusOf('dup-a1')).toBe('cloud');
  });

  it('honours a user-chosen keeper and trashes the original pick', async () => {
    await scanned();
    const g = (await repo.allGroups()).find((x) => x.itemIds.includes('burst-1'))!;
    const chosen = { ...g, decisions: Object.fromEntries(g.itemIds.map((id) => [id, id === 'burst-5' ? 'keep' : 'trash'])) as Record<string, 'keep' | 'trash'> };
    const plan = await planClean([chosen], repo);
    expect(plan.toTrash.map((i) => i.mediaKey).sort()).toEqual(['burst-1', 'burst-2', 'burst-3', 'burst-4']);
  });

  it('never empties a group even if every item is marked for trash', async () => {
    await scanned();
    const g = (await repo.allGroups()).find((x) => x.itemIds.includes('burst-1'))!;
    const all = { ...g, decisions: Object.fromEntries(g.itemIds.map((id) => [id, 'trash'])) as Record<string, 'keep' | 'trash'> };
    const plan = await planClean([all], repo);
    expect(plan.toTrash).toHaveLength(g.itemIds.length - 1);
  });

  it('real run trashes in batches, updates status and logs each batch', async () => {
    const adapter = await scanned();
    const groups = (await repo.allGroups()).filter((g) => g.itemIds.includes('burst-1'));
    const job = await runClean(cleanJob(), groups, { adapter, repo, dryRun: false, batchSize: 2, sleep: async () => {} });
    expect(job.state).toBe('done');
    expect(adapter.trashCalls.map((c) => c.length)).toEqual([2, 2]);
    expect(job.counts.trashed).toBe(4);
    expect((await repo.itemsByStatus('trashed')).length).toBe(4);
    expect((await repo.recentAudit()).filter((e) => e.action === 'trash')).toHaveLength(2);
  });

  it('a rescan keeps sizes fetched earlier', async () => {
    const adapter = await scanned();
    const before = (await repo.getItem('vid-1'))!.sizeBytes;
    await repo.upsertListedItems((await adapter.listItems(null)).items);
    expect((await repo.getItem('vid-1'))?.sizeBytes ?? before).toBe(before);
  });
});

describe('scan job without a model', () => {
  it('still finds duplicates when the embedding model cannot load', async () => {
    const repo2 = await freshRepo();
    const broken: Analyzer = { ...fakeAnalyzer, embed: async () => { throw new Error('model download blocked'); } };
    const job = await runScan(newScanJob('s4', 0), { adapter: new MockAdapter(), repo: repo2, analyzer: broken, settings });
    expect(job.state).toBe('done');
    expect(job.warning).toMatch(/model download blocked/);
    const groups = await repo2.allGroups();
    expect(groups.some((g) => g.kind === 'duplicate')).toBe(true);
    expect(groups.some((g) => g.kind === 'similar')).toBe(false);
  });
});
