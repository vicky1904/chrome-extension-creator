import { describe, expect, it } from 'vitest';
import { dhash, hamming, hashBands, laplacianVariance, phash, resizeGray, toGray } from '@/ml/phash';
import { synthImage } from './helpers';

describe('perceptual hashes', () => {
  it('produce 16 hex chars', () => {
    const img = synthImage(1);
    expect(phash(img)).toMatch(/^[0-9a-f]{16}$/);
    expect(dhash(img)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('are identical for the same image and stable under rescaling', () => {
    const img = synthImage(7, 200, 150);
    const smaller = resizeGray(img, 100, 75);
    expect(hamming(phash(img), phash(img))).toBe(0);
    expect(hamming(phash(img), phash(smaller))).toBeLessThanOrEqual(4);
  });

  it('separate different scenes', () => {
    const d = hamming(phash(synthImage(1)), phash(synthImage(2)));
    expect(d).toBeGreaterThan(12);
  });

  it('keep small perturbations close', () => {
    const d = hamming(phash(synthImage(3, 96, 72, 0)), phash(synthImage(3, 96, 72, 1)));
    expect(d).toBeLessThan(12);
  });

  it('hamming counts differing bits', () => {
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hamming('0000000000000001', '0000000000000000')).toBe(1);
    expect(hamming('8000000000000000', '0000000000000000')).toBe(1);
  });

  it('bands guarantee a shared band for distance <= 3', () => {
    const a = 'abcdef0123456789';
    const b = 'abcdef0123456788'; // distance 1
    const shared = hashBands(a).filter((x) => hashBands(b).includes(x));
    expect(shared.length).toBeGreaterThan(0);
  });
});

describe('image helpers', () => {
  it('toGray uses luminance weights', () => {
    const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);
    expect(g.data[0]).toBeCloseTo(76.245, 2);
    expect(g.data[1]).toBeCloseTo(149.685, 2);
  });

  it('sharp images have higher laplacian variance than blurred ones', () => {
    const sharp = synthImage(5, 64, 64);
    const blurred = resizeGray(resizeGray(sharp, 16, 16), 64, 64);
    expect(laplacianVariance(sharp)).toBeGreaterThan(laplacianVariance(blurred));
  });
});
