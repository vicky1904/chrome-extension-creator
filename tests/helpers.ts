import { IDBFactory } from 'fake-indexeddb';
import { Repo } from '@/storage/repo';
import type { GrayImage } from '@/ml/phash';

/** Fresh isolated database per test. */
export async function freshRepo(): Promise<Repo> {
  globalThis.indexedDB = new IDBFactory();
  return Repo.open();
}

/** Deterministic synthetic grey image: seeded blobs on a gradient. */
export function synthImage(seed: number, w = 96, h = 72, jitter = 0): GrayImage {
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const blobs = Array.from({ length: 6 }, () => ({ x: rand() * w, y: rand() * h, r: 6 + rand() * 16, v: 40 + rand() * 200 }));
  const base = rand() * 120;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = base + (x / w) * 60;
      for (const b of blobs) {
        const dx = x - b.x - jitter;
        const dy = y - b.y + jitter;
        if (dx * dx + dy * dy < b.r * b.r) v = b.v;
      }
      data[y * w + x] = v;
    }
  }
  return { width: w, height: h, data };
}
