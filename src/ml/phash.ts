/**
 * Perceptual hashing over raw pixel buffers. Pure functions, no DOM, so they
 * run in the offscreen document, a worker, or Node tests.
 *
 * Hashes are 64-bit values represented as 16 lowercase hex characters.
 */

export interface GrayImage {
  width: number;
  height: number;
  /** Row-major luminance 0..255. */
  data: Float32Array;
}

/** Convert RGBA bytes to luminance using Rec. 601 weights. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayImage {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!;
  }
  return { width, height, data: out };
}

/** Area-averaging downscale. Good enough for hashing and cheap. */
export function resizeGray(img: GrayImage, w: number, h: number): GrayImage {
  const out = new Float32Array(w * h);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let acc = 0;
      let n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          acc += img.data[yy * img.width + xx]!;
          n++;
        }
      }
      out[y * w + x] = n ? acc / n : 0;
    }
  }
  return { width: w, height: h, data: out };
}

/** Difference hash: 9x8 grid, bit set when left pixel is brighter than right. */
export function dhash(img: GrayImage): string {
  const g = resizeGray(img, 9, 8);
  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const b = g.data[y * 9 + x]! > g.data[y * 9 + x + 1]! ? 1 : 0;
      if (bit < 32) hi = (hi << 1) | b;
      else lo = (lo << 1) | b;
      bit++;
    }
  }
  return toHex(hi, lo);
}

/** pHash: 32x32 DCT, keep the top-left 8x8 (minus DC), threshold at the median. */
export function phash(img: GrayImage): string {
  const N = 32;
  const g = resizeGray(img, N, N);
  const dct = dct2d(g.data, N);
  const coeffs: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (x !== 0 || y !== 0) coeffs.push(dct[y * N + x]!);
  const sorted = [...coeffs].sort((a, b) => a - b);
  const median = (sorted[31]! + sorted[32]!) / 2;
  let hi = 0;
  let lo = 0;
  let bit = 0;
  // 63 coefficients + 1 padding bit (DC position) = 64 bits.
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const b = x === 0 && y === 0 ? 0 : dct[y * N + x]! > median ? 1 : 0;
      if (bit < 32) hi = (hi << 1) | b;
      else lo = (lo << 1) | b;
      bit++;
    }
  }
  return toHex(hi, lo);
}

const COS_CACHE = new Map<number, Float32Array>();
function cosTable(N: number): Float32Array {
  let t = COS_CACHE.get(N);
  if (!t) {
    t = new Float32Array(N * N);
    for (let u = 0; u < N; u++) for (let x = 0; x < N; x++) t[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
    COS_CACHE.set(N, t);
  }
  return t;
}

/** Separable DCT-II. Only the top-left 8x8 block is needed but we compute rows fully for simplicity. */
function dct2d(data: Float32Array, N: number): Float32Array {
  const c = cosTable(N);
  const rows = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < N; x++) s += data[y * N + x]! * c[u * N + x]!;
      rows[y * N + u] = s;
    }
  }
  const out = new Float32Array(N * N);
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += rows[y * N + u]! * c[v * N + y]!;
      out[v * N + u] = s;
    }
  }
  return out;
}

export function toHex(hi: number, lo: number): string {
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

/** Hamming distance between two 16-hex-char hashes. */
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < 16; i += 8) {
    let x = (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0;
    while (x) {
      x &= x - 1;
      d++;
    }
  }
  return d;
}

/** Variance of a 3x3 Laplacian: a cheap sharpness estimate. Higher is sharper. */
export function laplacianVariance(img: GrayImage): number {
  const { width: w, height: h, data } = img;
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - w]! - data[i + w]!;
      sum += v;
      sq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sq / n - mean * mean;
}

export function meanLuminance(img: GrayImage): number {
  let s = 0;
  for (let i = 0; i < img.data.length; i++) s += img.data[i]!;
  return s / img.data.length;
}

/**
 * Multi-index bands for fast near-duplicate candidate lookup. Two hashes with
 * hamming distance <= 3 share at least one of four 16-bit bands.
 */
export function hashBands(hash: string): string[] {
  return [0, 4, 8, 12].map((i) => `${i / 4}:${hash.slice(i, i + 4)}`);
}
