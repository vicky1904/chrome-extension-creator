import type { Path } from './schema';

/** Resolve a config path against parsed JSON. Returns undefined on any miss. */
export function pick(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const step of path) {
    if (cur === null || cur === undefined) return undefined;
    if (step === 'ext') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur.find((e) => e !== null && typeof e === 'object' && !Array.isArray(e));
      continue;
    }
    if (typeof step === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = step < 0 ? cur[cur.length + step] : cur[step];
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[step];
  }
  return cur;
}

export function pickNumber(root: unknown, path: Path): number | null {
  const v = pick(root, path);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function pickString(root: unknown, path: Path): string | null {
  const v = pick(root, path);
  return typeof v === 'string' ? v : null;
}

export function pickBoolean(root: unknown, path: Path): boolean | null {
  const v = pick(root, path);
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === 0) return v === 1;
  return null;
}
