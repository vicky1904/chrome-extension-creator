import { describe, expect, it } from 'vitest';
import { pickBestShot } from '@/ml/best-shot';
import { FIXTURE_ITEMS } from '@/adapter/mock/fixtures';
import type { ItemAnalysis, MediaItem } from '@/shared/types';

const item = (k: string, extra: Partial<MediaItem> = {}): MediaItem => ({ ...FIXTURE_ITEMS[2]!, mediaKey: k, isFavorite: false, ...extra });
const an = (k: string, sharpness: number, luminance = 120): ItemAnalysis => ({ mediaKey: k, phash: null, dhash: null, sharpness, luminance, analyzedAt: 0 });

describe('best shot', () => {
  it('prefers favorites above all', () => {
    const r = pickBestShot([{ item: item('a'), analysis: an('a', 100) }, { item: item('b', { isFavorite: true }), analysis: an('b', 1) }]);
    expect(r.keepId).toBe('b');
  });

  it('prefers sharper shots at equal resolution', () => {
    const r = pickBestShot([{ item: item('a'), analysis: an('a', 10) }, { item: item('b'), analysis: an('b', 90) }]);
    expect(r.keepId).toBe('b');
    expect(r.reasons.b).toContain('sharpest');
  });

  it('penalises near-black frames and copies', () => {
    const r = pickBestShot([
      { item: item('dark'), analysis: an('dark', 90, 3) },
      { item: item('copy', { fileName: 'IMG_1 (1).jpg' }), analysis: an('copy', 80) },
      { item: item('ok'), analysis: an('ok', 80) },
    ]);
    expect(r.keepId).toBe('ok');
  });
});
