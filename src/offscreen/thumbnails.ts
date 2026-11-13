import { toGray, resizeGray, phash, dhash, laplacianVariance, meanLuminance } from '@/ml/phash';
import type { AnalyzeResult } from '@/shared/messages';

/** Fetch a thumbnail and decode to RGBA via OffscreenCanvas. */
export async function fetchDecoded(url: string, size: number): Promise<{ rgba: Uint8ClampedArray; width: number; height: number; blob: Blob }> {
  const blob = await fetchThumb(url);
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  return { rgba: img.data, width: w, height: h, blob };
}

async function fetchThumb(url: string): Promise<Blob> {
  if (url.startsWith('mock://')) return syntheticThumb(url);
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`thumbnail HTTP ${res.status}`);
  return res.blob();
}

/**
 * Deterministic synthetic image for the mock adapter: the scene name seeds a
 * gradient plus a few shapes; a "-vN" suffix perturbs it slightly so burst
 * shots hash close but not identical.
 */
export async function syntheticThumb(url: string): Promise<Blob> {
  const scene = url.replace('mock://thumb/', '');
  const m = /^(.*?)(?:-v(\d+))?$/.exec(scene)!;
  const base = m[1]!;
  const variant = Number(m[2] ?? 0);
  let seed = 0;
  for (const ch of base) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const W = 256;
  const H = 192;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${rand() * 360}, 60%, ${30 + rand() * 30}%)`);
  g.addColorStop(1, `hsl(${rand() * 360}, 60%, ${30 + rand() * 30}%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `hsl(${rand() * 360}, 70%, 50%)`;
    const jitter = variant * 3;
    ctx.beginPath();
    ctx.arc(rand() * W + jitter, rand() * H - jitter, 15 + rand() * 40, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

export async function analyzeThumb(mediaKey: string, url: string): Promise<AnalyzeResult> {
  try {
    const { rgba, width, height } = await fetchDecoded(url, 128);
    const gray = toGray(rgba, width, height);
    const small = resizeGray(gray, 64, 64);
    return {
      mediaKey,
      phash: phash(gray),
      dhash: dhash(gray),
      sharpness: laplacianVariance(small),
      luminance: meanLuminance(small),
    };
  } catch (e) {
    return { mediaKey, phash: null, dhash: null, sharpness: null, luminance: null, error: e instanceof Error ? e.message : String(e) };
  }
}
