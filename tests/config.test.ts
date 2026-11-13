import { describe, expect, it } from 'vitest';
import { pick, pickBoolean, pickNumber } from '@/config/path';
import { DEFAULT_CONFIG } from '@/config/default-config';
import { compareVersions, validateConfig } from '@/config/validate';

describe('config paths', () => {
  const doc = [['k', ['thumb', 10, 20]], 5, { '42': [true] }];
  it('resolves indices, negative indices and ext bags', () => {
    expect(pick(doc, [0, 1, 0])).toBe('thumb');
    expect(pick(doc, [-1, '42', 0])).toBe(true);
    expect(pick(doc, ['ext', '42', 0])).toBe(true);
    expect(pick(doc, [9, 9])).toBeUndefined();
    expect(pickNumber(doc, [1])).toBe(5);
    expect(pickBoolean([1], [0])).toBe(true);
  });
});

describe('config validation', () => {
  it('accepts the default config', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toBe(true);
  });
  it('rejects malformed configs', () => {
    expect(validateConfig(null)).toBe(false);
    expect(validateConfig({ ...DEFAULT_CONFIG, schemaVersion: 2 })).toBe(false);
    expect(validateConfig({ ...DEFAULT_CONFIG, rpc: { ...DEFAULT_CONFIG.rpc, storageQuota: { id: 'bad id!' } } })).toBe(false);
    expect(validateConfig({ ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits, trashBatch: 0 } })).toBe(false);
    expect(validateConfig({ ...DEFAULT_CONFIG, thumb: { sizeSuffix: '=s0' } })).toBe(false);
  });
  it('compares versions', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
  });
});
