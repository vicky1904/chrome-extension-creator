import type { Group, MediaItem, ReclaimableSummary } from '@/shared/types';

/**
 * Reclaimable bytes shown on the badge. Only items that take up quota count.
 * Large videos are listed, not counted as reclaimable, because deleting them
 * is a user judgement rather than a redundancy finding.
 */
export function summarize(groups: Group[], items: MediaItem[], largeVideoMinBytes: number, now = Date.now()): ReclaimableSummary {
  let duplicatesBytes = 0;
  let similarBytes = 0;
  for (const g of groups) {
    if (g.kind === 'duplicate') duplicatesBytes += g.reclaimableBytes;
    else similarBytes += g.reclaimableBytes;
  }
  const largeVideosBytes = items
    .filter((i) => i.status === 'cloud' && i.durationMs !== null && i.takesUpSpace !== false && (i.spaceTakenBytes ?? i.sizeBytes ?? 0) >= largeVideoMinBytes)
    .reduce((a, i) => a + (i.spaceTakenBytes ?? i.sizeBytes ?? 0), 0);
  return {
    totalBytes: duplicatesBytes + similarBytes,
    duplicatesBytes,
    similarBytes,
    largeVideosBytes,
    groupCount: groups.length,
    computedAt: now,
  };
}
