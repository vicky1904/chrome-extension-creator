import type { AdapterConfig } from '@/config/schema';

export interface PageTokens {
  at: string;
  sid: string;
  bl: string;
  /** Base path, always ending with '/'. */
  path: string;
  rapt: string | null;
}

/**
 * Content scripts run in an isolated world and cannot read page globals
 * directly. Google inlines `window.WIZ_global_data = {...}` in a script tag,
 * so we parse it out of the DOM instead. Falls back to a MAIN-world probe if
 * the caller supplies one.
 */
export function extractTokensFromHtml(html: string, cfg: AdapterConfig): PageTokens | null {
  const name = cfg.transport.globalName;
  const idx = html.indexOf(`${name} = `);
  const start = idx >= 0 ? html.indexOf('{', idx) : -1;
  if (start < 0) return null;
  const json = sliceBalancedJson(html, start);
  if (!json) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  return tokensFromGlobal(obj, cfg);
}

export function tokensFromGlobal(obj: Record<string, unknown>, cfg: AdapterConfig): PageTokens | null {
  const g = cfg.transport.globals;
  const at = obj[g.at];
  const sid = obj[g.sid];
  const bl = obj[g.bl];
  const path = obj[g.path];
  const rapt = obj[g.rapt];
  if (typeof at !== 'string' || typeof sid !== 'string' || typeof bl !== 'string') return null;
  let p = typeof path === 'string' && path.length > 0 ? path : '/_/PhotosUi/';
  if (!p.endsWith('/')) p += '/';
  return { at, sid, bl, path: p, rapt: typeof rapt === 'string' ? rapt : null };
}

/** Return the JSON object literal starting at `start`, honouring strings. */
function sliceBalancedJson(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

export function readTokensFromDocument(doc: Document, cfg: AdapterConfig): PageTokens | null {
  for (const script of Array.from(doc.scripts)) {
    const text = script.textContent ?? '';
    if (!text.includes(cfg.transport.globalName)) continue;
    const t = extractTokensFromHtml(text, cfg);
    if (t) return t;
  }
  return null;
}
