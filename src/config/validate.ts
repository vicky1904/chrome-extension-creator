import type { AdapterConfig, Path } from './schema';

/**
 * Structural validation for a config object coming from an untrusted remote
 * JSON file. We do not trust the remote host blindly: a malformed config must
 * fall back to the bundled default rather than crash the adapter.
 */
export function validateConfig(x: unknown): x is AdapterConfig {
  if (!isObj(x)) return false;
  if (x.schemaVersion !== 1) return false;
  if (typeof x.revision !== 'number') return false;
  if (typeof x.minExtensionVersion !== 'string') return false;
  if (!isObj(x.transport) || !isObj(x.rpc) || !isObj(x.limits) || !isObj(x.paths) || !isObj(x.thumb)) return false;

  const t = x.transport;
  if (typeof t.endpointSuffix !== 'string' || typeof t.globalName !== 'string') return false;
  if (!isObj(t.globals)) return false;
  for (const k of ['at', 'sid', 'bl', 'path', 'rapt']) if (typeof t.globals[k] !== 'string') return false;
  for (const k of ['maxRetries', 'retryBaseDelayMs', 'concurrency', 'minIntervalMs']) if (typeof t[k] !== 'number') return false;

  for (const v of Object.values(x.rpc)) {
    if (!isObj(v) || typeof v.id !== 'string' || !/^[A-Za-z0-9]{3,12}$/.test(v.id)) return false;
  }
  for (const k of ['listPageSize', 'mediaInfoBatch', 'trashBatch']) {
    const v = x.limits[k];
    if (typeof v !== 'number' || v < 1 || v > 10000) return false;
  }
  if (!walkPaths(x.paths)) return false;
  if (typeof x.thumb.sizeSuffix !== 'string' || !x.thumb.sizeSuffix.includes('{w}')) return false;
  return true;
}

function walkPaths(node: unknown): boolean {
  if (Array.isArray(node)) return isPath(node);
  if (!isObj(node)) return false;
  return Object.values(node).every(walkPaths);
}

function isPath(p: unknown): p is Path {
  return Array.isArray(p) && p.every((s) => typeof s === 'number' || typeof s === 'string');
}

function isObj(x: unknown): x is Record<string, any> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Compare "1.2.3" style versions. Returns negative if a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
