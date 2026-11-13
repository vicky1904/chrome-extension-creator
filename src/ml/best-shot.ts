import type { ItemAnalysis, MediaItem } from '@/shared/types';

export interface ShotFeatures {
  item: MediaItem;
  analysis: ItemAnalysis | null;
}

/**
 * Score a shot for "which one to keep". Deterministic and explainable: the
 * UI shows the reasons so users can trust the pre-selection.
 */
export function scoreShot(f: ShotFeatures, groupMax: { sharpness: number; pixels: number; bytes: number }): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (f.item.isFavorite) {
    score += 100;
    reasons.push('favorite');
  }
  const pixels = (f.item.width ?? 0) * (f.item.height ?? 0);
  if (groupMax.pixels > 0) {
    const r = pixels / groupMax.pixels;
    score += 30 * r;
    if (r >= 0.999) reasons.push('highest resolution');
  }
  const sharp = f.analysis?.sharpness ?? 0;
  if (groupMax.sharpness > 0) {
    const r = sharp / groupMax.sharpness;
    score += 40 * r;
    if (r >= 0.999) reasons.push('sharpest');
  }
  const bytes = f.item.sizeBytes ?? 0;
  if (groupMax.bytes > 0) {
    score += 10 * (bytes / groupMax.bytes);
  }
  if (f.item.isPartialUpload) {
    score -= 50;
    reasons.push('partial upload');
  }
  if (f.analysis?.luminance !== null && f.analysis?.luminance !== undefined && f.analysis.luminance < 12) {
    score -= 30;
    reasons.push('very dark');
  }
  // Prefer the original over copies named like "IMG_0001 (1).jpg".
  if (f.item.fileName && /\(\d+\)\.|copy/i.test(f.item.fileName)) {
    score -= 5;
    reasons.push('looks like a copy');
  }
  return { score, reasons };
}

export function pickBestShot(shots: ShotFeatures[]): { keepId: string; reasons: Record<string, string[]> } {
  const groupMax = {
    sharpness: Math.max(0, ...shots.map((s) => s.analysis?.sharpness ?? 0)),
    pixels: Math.max(0, ...shots.map((s) => (s.item.width ?? 0) * (s.item.height ?? 0))),
    bytes: Math.max(0, ...shots.map((s) => s.item.sizeBytes ?? 0)),
  };
  let best: { id: string; score: number } | null = null;
  const reasons: Record<string, string[]> = {};
  for (const s of shots) {
    const r = scoreShot(s, groupMax);
    reasons[s.item.mediaKey] = r.reasons;
    // Tie-break on earliest capture, then on key for determinism.
    if (!best || r.score > best.score || (r.score === best.score && s.item.takenAt < (shots.find((x) => x.item.mediaKey === best!.id)?.item.takenAt ?? Infinity))) {
      best = { id: s.item.mediaKey, score: r.score };
    }
  }
  return { keepId: best!.id, reasons };
}
