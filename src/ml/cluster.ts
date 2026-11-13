import type { Group, ItemAnalysis, ItemEmbedding, MediaItem } from '@/shared/types';
import { hamming, hashBands } from './phash';
import { cosineQ } from './similarity';
import { UnionFind } from './union-find';
import { pickBestShot } from './best-shot';

export interface ClusterOptions {
  duplicateHammingMax: number;
  similarThreshold: number;
  similarTimeWindowMs: number;
  now?: () => number;
}

export interface ClusterInput {
  items: MediaItem[];
  analyses: Map<string, ItemAnalysis>;
  embeddings: Map<string, ItemEmbedding>;
}

/**
 * Exact / near-exact duplicates: identical dimensions (or both unknown) and
 * perceptual hash distance <= threshold. No time constraint, since copies are
 * often re-uploaded months apart. Uses 16-bit bands to avoid O(n^2).
 */
export function findDuplicateGroups(input: ClusterInput, opts: ClusterOptions): Group[] {
  const { items, analyses } = input;
  const uf = new UnionFind();
  const buckets = new Map<string, string[]>();
  const byKey = new Map(items.map((i) => [i.mediaKey, i]));

  for (const it of items) {
    if (it.status !== 'cloud' || it.durationMs !== null) continue; // videos handled separately
    const h = analyses.get(it.mediaKey)?.phash;
    if (!h) continue;
    for (const band of hashBands(h)) {
      const b = buckets.get(band);
      if (b) b.push(it.mediaKey);
      else buckets.set(band, [it.mediaKey]);
    }
  }

  const seenPairs = new Set<string>();
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!;
        const b = members[j]!;
        const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const ia = byKey.get(a)!;
        const ib = byKey.get(b)!;
        if (!sameDims(ia, ib)) continue;
        const d = hamming(analyses.get(a)!.phash!, analyses.get(b)!.phash!);
        if (d <= opts.duplicateHammingMax) uf.union(a, b);
      }
    }
  }

  return uf.groups().map((ids) => buildGroup('duplicate', ids, input, opts, (a, b) => 1 - hamming(analyses.get(a)!.phash!, analyses.get(b)!.phash!) / 64));
}

/**
 * Similar shots: embedding cosine >= threshold AND captured within the time
 * window. Items sorted by time; a sliding window bounds comparisons.
 * Items already in a duplicate group are excluded so the two views don't
 * double-count reclaimable bytes.
 */
export function findSimilarGroups(input: ClusterInput, opts: ClusterOptions, exclude: Set<string> = new Set()): Group[] {
  const { items, embeddings } = input;
  const cands = items
    .filter((i) => i.status === 'cloud' && i.durationMs === null && !exclude.has(i.mediaKey) && embeddings.has(i.mediaKey))
    .sort((a, b) => a.takenAt - b.takenAt);
  const uf = new UnionFind();
  const sims = new Map<string, number>();

  for (let i = 0; i < cands.length; i++) {
    const a = cands[i]!;
    const ea = embeddings.get(a.mediaKey)!;
    for (let j = i + 1; j < cands.length; j++) {
      const b = cands[j]!;
      if (b.takenAt - a.takenAt > opts.similarTimeWindowMs) break;
      const eb = embeddings.get(b.mediaKey)!;
      if (ea.modelId !== eb.modelId) continue;
      const s = cosineQ(ea.q, eb.q);
      if (s >= opts.similarThreshold) {
        uf.union(a.mediaKey, b.mediaKey);
        sims.set(pairKey(a.mediaKey, b.mediaKey), s);
      }
    }
  }

  return uf.groups().map((ids) =>
    buildGroup('similar', ids, input, opts, (x, y) => sims.get(pairKey(x, y)) ?? cosineQ(embeddings.get(x)!.q, embeddings.get(y)!.q)),
  );
}

export function clusterAll(input: ClusterInput, opts: ClusterOptions): Group[] {
  const dups = findDuplicateGroups(input, opts);
  const inDup = new Set(dups.flatMap((g) => g.itemIds));
  const sims = findSimilarGroups(input, opts, inDup);
  return [...dups, ...sims];
}

function buildGroup(kind: Group['kind'], ids: string[], input: ClusterInput, opts: ClusterOptions, pairSim: (a: string, b: string) => number): Group {
  const byKey = new Map(input.items.map((i) => [i.mediaKey, i]));
  const shots = ids.map((id) => ({ item: byKey.get(id)!, analysis: input.analyses.get(id) ?? null }));
  const { keepId } = pickBestShot(shots);
  const sorted = [...ids].sort();
  let simSum = 0;
  let n = 0;
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    simSum += pairSim(sorted[i]!, sorted[j]!);
    n++;
  }
  const reclaimable = ids
    .filter((id) => id !== keepId)
    .map((id) => byKey.get(id)!)
    .filter((i) => i.takesUpSpace !== false)
    .reduce((acc, i) => acc + (i.spaceTakenBytes ?? i.sizeBytes ?? 0), 0);
  return {
    id: `${kind}:${sorted[0]}:${sorted.length}`,
    kind,
    itemIds: sorted,
    keepId,
    confidence: n ? simSum / n : 1,
    reclaimableBytes: reclaimable,
    reviewed: false,
    createdAt: (opts.now ?? Date.now)(),
  };
}

function sameDims(a: MediaItem, b: MediaItem): boolean {
  if (a.width === null || b.width === null || a.height === null || b.height === null) return true;
  return a.width === b.width && a.height === b.height;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
