import type { Group, Job, MediaKey, ReclaimableSummary, StorageUsage } from './types';

/**
 * Typed message protocol between the service worker, the content script on
 * photos.google.com, the offscreen document and the UI pages.
 *
 * Every message carries a `type`. Requests that expect a reply return a
 * `Reply<T>` so callers can distinguish failure from a missing listener.
 */

export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Reply<T> => ({ ok: true, value });
export const fail = (error: unknown): Reply<never> => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error),
});

/* ------------------------------------------------------------------ */
/* Service worker -> content script (adapter relay)                    */
/* ------------------------------------------------------------------ */

export interface AdapterCallMessage {
  type: 'adapter.call';
  method: string;
  args: unknown[];
}

export interface AdapterPingMessage {
  type: 'adapter.ping';
}

/* ------------------------------------------------------------------ */
/* Service worker -> offscreen document                                */
/* ------------------------------------------------------------------ */

export interface AnalyzeRequest {
  type: 'offscreen.analyze';
  items: { mediaKey: MediaKey; thumbUrl: string }[];
}

export interface AnalyzeResult {
  mediaKey: MediaKey;
  phash: string | null;
  dhash: string | null;
  sharpness: number | null;
  luminance: number | null;
  error?: string;
}

export interface EmbedRequest {
  type: 'offscreen.embed';
  modelId: string;
  items: { mediaKey: MediaKey; thumbUrl: string }[];
}

export interface EmbedResult {
  mediaKey: MediaKey;
  /** Float32 vector transferred as a plain array for structured clone. */
  vector: number[] | null;
  error?: string;
}

export interface ModelStatusRequest {
  type: 'offscreen.modelStatus';
  modelId: string;
}

export interface ModelStatus {
  modelId: string;
  state: 'not-loaded' | 'downloading' | 'ready' | 'error';
  device: 'webgpu' | 'wasm' | null;
  progress: number;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* UI -> service worker                                                */
/* ------------------------------------------------------------------ */

export type UiCommand =
  | { type: 'ui.getState' }
  | { type: 'ui.startScan' }
  | { type: 'ui.pauseJob'; jobId: string }
  | { type: 'ui.resumeJob'; jobId: string }
  | { type: 'ui.cancelJob'; jobId: string }
  | { type: 'ui.getGroups'; kind?: 'duplicate' | 'similar' }
  | { type: 'ui.decide'; groupId: string; decisions: Record<MediaKey, 'keep' | 'trash'> }
  | { type: 'ui.startClean'; groupIds: string[] }
  | { type: 'ui.openDashboard' }
  | { type: 'ui.runSelfTest' };

export interface UiState {
  job: Job | null;
  usage: StorageUsage | null;
  reclaimable: ReclaimableSummary | null;
  adapterHealthy: boolean | null;
  licensed: boolean;
  dryRun: boolean;
}

export type UiGroupsReply = { groups: Group[] };

/* ------------------------------------------------------------------ */

export type AnyMessage =
  | AdapterCallMessage
  | AdapterPingMessage
  | AnalyzeRequest
  | EmbedRequest
  | ModelStatusRequest
  | UiCommand;

export function isMessage(x: unknown): x is AnyMessage {
  return typeof x === 'object' && x !== null && typeof (x as { type?: unknown }).type === 'string';
}
