import type { PhotosAdapter } from '@/adapter/types';
import type { Repo } from '@/storage/repo';
import type { Group, Job, MediaItem } from '@/shared/types';
import { logger } from '@/shared/log';

const log = logger('clean');

export interface CleanDeps {
  adapter: PhotosAdapter;
  repo: Repo;
  dryRun: boolean;
  batchSize?: number;
  delayMs?: number;
  shouldStop?: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CleanPlan {
  toTrash: MediaItem[];
  skipped: { item: MediaItem; reason: string }[];
  bytes: number;
}

/** The item the user (or the pre-selection) chose to keep in a group. */
export function effectiveKeeper(g: Group): string {
  return Object.entries(g.decisions ?? {}).find(([, d]) => d === 'keep')?.[0] ?? g.keepId;
}

/**
 * Decide exactly what a clean run would trash. Reads local state only, so the
 * dry run shows the same plan the real run uses.
 *
 * Safety rules enforced here, not in the UI:
 *  - favorites and protected items are never trashed
 *  - an item without a dedup key is skipped (trash operates on dedup keys)
 *  - at least one item of every group stays in the library
 */
export async function planClean(groups: Group[], repo: Repo): Promise<CleanPlan> {
  const toTrash: MediaItem[] = [];
  const skipped: CleanPlan['skipped'] = [];
  for (const g of groups) {
    const keeper = effectiveKeeper(g);
    const members = (await Promise.all(g.itemIds.map((id) => repo.getItem(id)))).filter((i): i is MediaItem => !!i);
    const groupTrash: MediaItem[] = [];
    for (const item of members) {
      const decision = g.decisions?.[item.mediaKey] ?? (item.mediaKey === keeper ? 'keep' : 'trash');
      if (decision !== 'trash') continue;
      if (item.status !== 'cloud') { skipped.push({ item, reason: 'not in library' }); continue; }
      if (item.isFavorite || item.protected) { skipped.push({ item, reason: 'favorite or protected' }); continue; }
      if (!item.dedupKey) { skipped.push({ item, reason: 'no dedup key' }); continue; }
      groupTrash.push(item);
    }
    const remaining = members.filter((i) => i.status === 'cloud' && !groupTrash.includes(i));
    if (remaining.length === 0 && groupTrash.length > 0) {
      const spare = groupTrash.find((i) => i.mediaKey === keeper) ?? groupTrash[0]!;
      groupTrash.splice(groupTrash.indexOf(spare), 1);
      skipped.push({ item: spare, reason: 'kept so the group is not emptied' });
    }
    toTrash.push(...groupTrash);
  }
  const bytes = toTrash.filter((i) => i.takesUpSpace !== false).reduce((a, i) => a + (i.spaceTakenBytes ?? i.sizeBytes ?? 0), 0);
  return { toTrash, skipped, bytes };
}

export async function runClean(job: Job, groups: Group[], deps: CleanDeps): Promise<Job> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const batchSize = deps.batchSize ?? 100;
  const plan = await planClean(groups, deps.repo);
  job = { ...job, state: 'running', updatedAt: now(), counts: { ...job.counts, planned: plan.toTrash.length, plannedBytes: plan.bytes, skipped: plan.skipped.length } };
  await deps.repo.putJob(job);

  if (deps.dryRun) {
    await deps.repo.log({ at: now(), jobId: job.id, action: 'skip', mediaKeys: plan.toTrash.map((i) => i.mediaKey), bytes: plan.bytes, dryRun: true, detail: 'dry run: nothing trashed' });
    job = { ...job, state: 'done', finishedAt: now(), updatedAt: now() };
    await deps.repo.putJob(job);
    return job;
  }

  try {
    for (let i = 0; i < plan.toTrash.length; i += batchSize) {
      const chunk = plan.toTrash.slice(i, i + batchSize);
      const keys = chunk.map((it) => it.dedupKey!);
      await deps.adapter.trashItems(keys);
      await deps.repo.patchItems(chunk.map((it) => ({ mediaKey: it.mediaKey, status: 'trashed' as const })));
      const bytes = chunk.filter((it) => it.takesUpSpace !== false).reduce((a, it) => a + (it.spaceTakenBytes ?? it.sizeBytes ?? 0), 0);
      await deps.repo.log({ at: now(), jobId: job.id, action: 'trash', mediaKeys: chunk.map((it) => it.mediaKey), bytes, dryRun: false, detail: null });
      job = { ...job, updatedAt: now(), counts: { ...job.counts, trashed: (job.counts.trashed ?? 0) + chunk.length, trashedBytes: (job.counts.trashedBytes ?? 0) + bytes } };
      await deps.repo.putJob(job);
      if (deps.shouldStop?.()) {
        job = { ...job, state: 'paused' };
        await deps.repo.putJob(job);
        return job;
      }
      if (deps.delayMs) await sleep(deps.delayMs);
    }
    for (const g of groups) await deps.repo.putGroup({ ...g, reviewed: true });
    job = { ...job, state: 'done', finishedAt: now(), updatedAt: now() };
  } catch (e) {
    log.error('clean failed', e);
    await deps.repo.log({ at: now(), jobId: job.id, action: 'error', mediaKeys: [], bytes: 0, dryRun: false, detail: e instanceof Error ? e.message : String(e) });
    job = { ...job, state: 'failed', error: e instanceof Error ? e.message : String(e), updatedAt: now() };
  }
  await deps.repo.putJob(job);
  return job;
}
