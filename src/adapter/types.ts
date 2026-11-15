import type { DedupKey, MediaItem, MediaKey, StorageUsage } from '@/shared/types';

/**
 * The only interface the rest of the extension uses to talk to Google Photos.
 * Implementations: GoogleAdapter (live, runs in the content script) and
 * MockAdapter (fixtures, runs anywhere).
 */

export interface ListPage {
  items: MediaItem[];
  nextPageId: string | null;
}

export interface MediaInfo {
  mediaKey: MediaKey;
  fileName: string | null;
  sizeBytes: number | null;
  takesUpSpace: boolean | null;
  spaceTakenBytes: number | null;
  uploadedAt: number | null;
}

export interface TrashResult {
  requested: number;
  /** Google returns an opaque payload; we count what we asked for. */
  accepted: boolean;
}

export interface DownloadInfo {
  url: string;
  /** Original-quality URL when Google distinguishes it. */
  originalUrl: string | null;
  livePhotoVideoUrl: string | null;
}

export interface SelfTestReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
  ranAt: number;
}

export interface PhotosAdapter {
  readonly name: 'google' | 'mock';

  /** Enumerate the library newest first. Pass the previous nextPageId to continue. */
  listItems(pageId: string | null): Promise<ListPage>;

  /** Enumerate the Trash. */
  listTrash(pageId: string | null): Promise<ListPage>;

  /** Favorites only. Used to mark protected items. */
  listFavorites(pageId: string | null): Promise<ListPage>;

  /** Size and quota flags for many items at once. */
  getMediaInfo(mediaKeys: MediaKey[]): Promise<MediaInfo[]>;

  getStorageUsage(): Promise<StorageUsage>;

  getDownloadInfo(mediaKey: MediaKey): Promise<DownloadInfo>;

  /** Move to Trash. Never permanently deletes. */
  trashItems(dedupKeys: DedupKey[]): Promise<TrashResult>;

  restoreItems(dedupKeys: DedupKey[]): Promise<TrashResult>;

  /** Verify the live page still matches the configuration. */
  selfTest(): Promise<SelfTestReport>;
}

/** Method names that may be relayed over messaging. */
export const ADAPTER_METHODS = [
  'listItems',
  'listTrash',
  'listFavorites',
  'getMediaInfo',
  'getStorageUsage',
  'getDownloadInfo',
  'trashItems',
  'restoreItems',
  'selfTest',
] as const satisfies readonly (keyof PhotosAdapter)[];

export type AdapterMethod = (typeof ADAPTER_METHODS)[number];

export function isAdapterMethod(x: string): x is AdapterMethod {
  return (ADAPTER_METHODS as readonly string[]).includes(x);
}
