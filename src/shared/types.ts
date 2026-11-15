/**
 * Core domain types shared by every layer. Nothing in here may reference a
 * Google selector, RPC id or response index; that knowledge lives in
 * src/adapter/google and src/config only.
 */

export type MediaKey = string;
export type DedupKey = string;

export type ItemStatus = 'cloud' | 'trashed' | 'offloaded';

export interface MediaItem {
  mediaKey: MediaKey;
  /** Google's content hash key. Trash/restore operate on dedup keys. */
  dedupKey: DedupKey | null;
  /** Capture time, ms since epoch (already adjusted by Google for timezone). */
  takenAt: number;
  /** Upload time, ms since epoch, when known. */
  uploadedAt: number | null;
  timezoneOffsetMs: number | null;
  width: number | null;
  height: number | null;
  /** Video duration in ms; null for stills. */
  durationMs: number | null;
  isLivePhoto: boolean;
  isFavorite: boolean;
  isArchived: boolean;
  isPartialUpload: boolean;
  /** Base thumbnail URL without size suffix. */
  thumbUrl: string;
  /** Bytes on disk, from the batch media-info call. null until fetched. */
  sizeBytes: number | null;
  /**
   * Whether this item counts against the account quota. Items backed up
   * before June 2021, or Pixel original-quality items, do not. Trashing an
   * item with takesUpSpace === false frees nothing, so it must never be
   * counted in "reclaimable" numbers.
   */
  takesUpSpace: boolean | null;
  /** Bytes actually charged to quota (may differ from sizeBytes). */
  spaceTakenBytes: number | null;
  fileName: string | null;
  status: ItemStatus;
  /** User-protected via album or manual flag. Never touched. */
  protected: boolean;
}

export interface ItemAnalysis {
  mediaKey: MediaKey;
  /** 64-bit perceptual hash as 16 hex chars. */
  phash: string | null;
  /** 64-bit difference hash as 16 hex chars. */
  dhash: string | null;
  /** Laplacian variance of the grey thumbnail: higher means sharper. */
  sharpness: number | null;
  /** Mean luminance 0..255; used to flag near-black frames. */
  luminance: number | null;
  analyzedAt: number;
}

export interface ItemEmbedding {
  mediaKey: MediaKey;
  modelId: string;
  dim: number;
  /** L2-normalised vector quantised to int8 (value = q / 127). */
  q: Int8Array;
}

export type GroupKind = 'duplicate' | 'similar';

export interface Group {
  id: string;
  kind: GroupKind;
  itemIds: MediaKey[];
  /** Pre-selected item to keep. */
  keepId: MediaKey;
  /** Mean pairwise similarity or 1 - normalised hamming distance. */
  confidence: number;
  /** Bytes reclaimable if every non-keep item that takes up space is trashed. */
  reclaimableBytes: number;
  reviewed: boolean;
  /** User decision per item; undefined means "follow keepId". */
  decisions?: Record<MediaKey, 'keep' | 'trash'>;
  createdAt: number;
}

export type JobType = 'scan' | 'clean' | 'offload';
export type JobState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface ScanCursor {
  phase: 'enumerate' | 'sizes' | 'hash' | 'embed' | 'cluster' | 'done';
  /** Opaque pagination token for the enumerate phase. */
  pageId: string | null;
  /** Count of items processed in the current phase. */
  processed: number;
  total: number | null;
}

export interface Job {
  id: string;
  type: JobType;
  state: JobState;
  cursor: ScanCursor | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  error: string | null;
  /** Non-fatal problem the user should know about. */
  warning?: string | null;
  counts: Record<string, number>;
}

export interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
  usedByPhotosBytes: number | null;
  fetchedAt: number;
}

export interface ReclaimableSummary {
  totalBytes: number;
  duplicatesBytes: number;
  similarBytes: number;
  largeVideosBytes: number;
  groupCount: number;
  computedAt: number;
}

export interface Settings {
  /** Use the fixture-backed mock adapter instead of Google. Dev only. */
  useMockAdapter: boolean;
  /** Minutes: two shots further apart than this are never "similar". */
  similarTimeWindowMin: number;
  /** Cosine threshold for the similar-shot grouping. Model dependent. */
  similarThreshold: number;
  /** Hamming distance threshold for near-exact duplicates. */
  duplicateHammingMax: number;
  /** Videos larger than this are listed in "large videos". */
  largeVideoMinBytes: number;
  /** Preferred embedding model id from the model registry. */
  embeddingModelId: string;
  dryRun: boolean;
  licensed: boolean;
  protectedAlbumIds: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  useMockAdapter: false,
  similarTimeWindowMin: 10,
  similarThreshold: 0.9,
  duplicateHammingMax: 2,
  largeVideoMinBytes: 200 * 1024 * 1024,
  embeddingModelId: 'dinov2-base',
  dryRun: true,
  licensed: false,
  protectedAlbumIds: [],
};

export interface AuditLogEntry {
  id?: number;
  at: number;
  jobId: string | null;
  action: 'trash' | 'restore' | 'offload' | 'verify' | 'skip' | 'error';
  mediaKeys: MediaKey[];
  bytes: number;
  dryRun: boolean;
  detail: string | null;
}
