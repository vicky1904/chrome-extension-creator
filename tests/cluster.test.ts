import { describe, expect, it } from 'vitest';
import { clusterAll, findDuplicateGroups, findSimilarGroups } from '@/ml/cluster';
import { quantize, l2normalize } from '@/ml/similarity';
import { summarize } from '@/ml/summary';
import type { ItemAnalysis, ItemEmbedding, MediaItem } from '@/shared/types';

const base: Omit<MediaItem, 'mediaKey' | 'takenAt'> = {
  dedupKey: null, uploadedAt: null, timezoneOffsetMs: null, width: 4000, height: 3000, durationMs: null,
  isLivePhoto: false, isFavorite: false, isArchived: false, isPartialUpload: false, thumbUrl: 'x',
  sizeBytes: 1000, takesUpSpace: true, spaceTakenBytes: 1000, fileName: null, status: 'cloud', protected: false,
};
const it_ = (k: string, t: number, extra: Partial<MediaItem> = {}): MediaItem => ({ ...base, mediaKey: k, dedupKey: `d-${k}`, takenAt: t, ...extra });
const an = (k: string, phash: string, sharpness = 10): ItemAnalysis => ({ mediaKey: k, phash, dhash: phash, sharpness, luminance: 128, analyzedAt: 0 });
const emb = (k: string, v: number[]): ItemEmbedding => ({ mediaKey: k, modelId: 'm', dim: v.length, q: quantize(l2normalize(Float32Array.from(v))) });
const opts = { duplicateHammingMax: 2, similarThreshold: 0.9, similarTimeWindowMs: 10 * 60_000, now: () => 0 };

describe('duplicate grouping', () => {
  it('groups identical hashes regardless of time', () => {
    const items = [it_('a', 0), it_('b', 90 * 86_400_000), it_('c', 5)];
    const analyses = new Map([['a', an('a', 'ffff0000ffff0000')], ['b', an('b', 'ffff0000ffff0001')], ['c', an('c', '0123456789abcdef')]]);
    const groups = findDuplicateGroups({ items, analyses, embeddings: new Map() }, opts);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.itemIds).toEqual(['a', 'b']);
  });

  it('does not group items with different dimensions', () => {
    const items = [it_('a', 0), it_('b', 0, { width: 1000, height: 750 })];
    const analyses = new Map([['a', an('a', 'ffff0000ffff0000')], ['b', an('b', 'ffff0000ffff0000')]]);
    expect(findDuplicateGroups({ items, analyses, embeddings: new Map() }, opts)).toHaveLength(0);
  });

  it('excludes videos and trashed items', () => {
    const items = [it_('a', 0, { durationMs: 1000 }), it_('b', 0, { durationMs: 1000 }), it_('c', 0, { status: 'trashed' }), it_('d', 0)];
    const h = 'ffff0000ffff0000';
    const analyses = new Map(['a', 'b', 'c', 'd'].map((k) => [k, an(k, h)]));
    expect(findDuplicateGroups({ items, analyses, embeddings: new Map() }, opts)).toHaveLength(0);
  });

  it('reclaimable bytes skip the keeper and items that take no space', () => {
    const items = [it_('a', 0, { spaceTakenBytes: 500 }), it_('b', 1, { takesUpSpace: false, spaceTakenBytes: 0 }), it_('c', 2, { spaceTakenBytes: 700 })];
    const h = 'ffff0000ffff0000';
    const analyses = new Map([['a', an('a', h, 50)], ['b', an('b', h, 1)], ['c', an('c', h, 1)]]);
    const [g] = findDuplicateGroups({ items, analyses, embeddings: new Map() }, opts);
    expect(g!.keepId).toBe('a'); // sharpest
    expect(g!.reclaimableBytes).toBe(700);
  });
});

describe('similar grouping', () => {
  it('groups close embeddings inside the time window only', () => {
    const items = [it_('a', 0), it_('b', 2000), it_('c', 4000), it_('far', 3 * 3_600_000)];
    const embeddings = new Map([
      ['a', emb('a', [1, 0.05, 0])],
      ['b', emb('b', [1, 0.07, 0.01])],
      ['c', emb('c', [0, 1, 0])],
      ['far', emb('far', [1, 0.05, 0])],
    ]);
    const groups = findSimilarGroups({ items, analyses: new Map(), embeddings }, opts);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.itemIds).toEqual(['a', 'b']);
  });

  it('ignores embeddings from a different model', () => {
    const items = [it_('a', 0), it_('b', 1)];
    const embeddings = new Map([['a', emb('a', [1, 0])], ['b', { ...emb('b', [1, 0]), modelId: 'other' }]]);
    expect(findSimilarGroups({ items, analyses: new Map(), embeddings }, opts)).toHaveLength(0);
  });

  it('clusterAll does not double count duplicates as similar', () => {
    const items = [it_('a', 0), it_('b', 1)];
    const h = 'ffff0000ffff0000';
    const analyses = new Map([['a', an('a', h)], ['b', an('b', h)]]);
    const embeddings = new Map([['a', emb('a', [1, 0])], ['b', emb('b', [1, 0])]]);
    const groups = clusterAll({ items, analyses, embeddings }, opts);
    expect(groups.map((g) => g.kind)).toEqual(['duplicate']);
    const s = summarize(groups, items, 1e9, 0);
    expect(s.totalBytes).toBe(1000);
    expect(s.similarBytes).toBe(0);
  });
});
