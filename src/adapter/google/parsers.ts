import type { AdapterConfig } from '@/config/schema';
import { pick, pickBoolean, pickNumber, pickString } from '@/config/path';
import type { MediaItem, StorageUsage } from '@/shared/types';
import type { ListPage, MediaInfo } from '../types';

/**
 * Pure functions turning raw batchexecute payloads into domain objects using
 * the index paths from the adapter config. Kept free of I/O so they can be
 * unit-tested against captured fixtures.
 */

export function parseListPage(payload: unknown, cfg: AdapterConfig): ListPage {
  const rawItems = pick(payload, cfg.paths.listPage.items);
  const items = Array.isArray(rawItems)
    ? rawItems.map((r) => parseLibraryItem(r, cfg)).filter((x): x is MediaItem => x !== null)
    : [];
  const next = pickString(payload, cfg.paths.listPage.nextPageId);
  return { items, nextPageId: next && next.length > 0 ? next : null };
}

export function parseTrashPage(payload: unknown, cfg: AdapterConfig): ListPage {
  const rawItems = pick(payload, cfg.paths.trashPage.items);
  const items = Array.isArray(rawItems)
    ? rawItems
        .map((r) => parseLibraryItem(r, cfg))
        .filter((x): x is MediaItem => x !== null)
        .map((x) => ({ ...x, status: 'trashed' as const }))
    : [];
  const next = pickString(payload, cfg.paths.trashPage.nextPageId);
  return { items, nextPageId: next && next.length > 0 ? next : null };
}

export function parseLibraryItem(raw: unknown, cfg: AdapterConfig): MediaItem | null {
  const p = cfg.paths.item;
  const mediaKey = pickString(raw, p.mediaKey);
  const thumb = pickString(raw, p.thumb);
  const takenAt = pickNumber(raw, p.timestamp);
  if (!mediaKey || !thumb || takenAt === null) return null;

  const live = pick(raw, p.livePhoto);
  const partial = pickNumber(raw, p.partialUploadMarker);
  return {
    mediaKey,
    dedupKey: pickString(raw, p.dedupKey),
    takenAt,
    uploadedAt: pickNumber(raw, p.creationTimestamp),
    timezoneOffsetMs: pickNumber(raw, p.timezoneOffset),
    width: pickNumber(raw, p.width),
    height: pickNumber(raw, p.height),
    durationMs: pickNumber(raw, p.durationMs),
    isLivePhoto: live !== undefined && live !== null,
    isFavorite: pickBoolean(raw, p.isFavorite) ?? false,
    isArchived: pickBoolean(raw, p.isArchived) ?? false,
    isPartialUpload: partial === 20,
    thumbUrl: stripThumbSuffix(thumb),
    sizeBytes: null,
    takesUpSpace: null,
    spaceTakenBytes: null,
    fileName: null,
    status: 'cloud',
    protected: false,
  };
}

export function parseMediaInfo(payload: unknown, cfg: AdapterConfig): MediaInfo[] {
  const p = cfg.paths.mediaInfo;
  const rows = pick(payload, p.rows);
  if (!Array.isArray(rows)) return [];
  const out: MediaInfo[] = [];
  for (const row of rows) {
    const mediaKey = pickString(row, p.rowKey);
    if (!mediaKey) continue;
    const bag = pick(row, p.quotaBag);
    const takes = pickNumber(bag, p.takesUpSpace);
    out.push({
      mediaKey,
      fileName: pickString(row, p.fileName),
      sizeBytes: pickNumber(row, p.size),
      takesUpSpace: takes === null ? null : takes === 1,
      spaceTakenBytes: pickNumber(bag, p.spaceTaken),
      uploadedAt: pickNumber(row, p.timestamp),
    });
  }
  return out;
}

export function parseStorageQuota(payload: unknown, cfg: AdapterConfig, now = Date.now()): StorageUsage {
  const used = pickNumber(payload, cfg.paths.quota.used);
  const limit = pickNumber(payload, cfg.paths.quota.limit);
  if (used === null || limit === null) throw new Error('storage quota payload did not match config paths');
  return {
    usedBytes: used,
    limitBytes: limit,
    usedByPhotosBytes: pickNumber(payload, cfg.paths.quota.usedByPhotos),
    fetchedAt: now,
  };
}

/** Google thumbnail URLs end in "=w123-h456-..." options. Remove them. */
export function stripThumbSuffix(url: string): string {
  const i = url.lastIndexOf('=');
  return i > url.lastIndexOf('/') ? url.slice(0, i) : url;
}

export function thumbUrlForSize(baseUrl: string, w: number, h: number, cfg: AdapterConfig): string {
  return stripThumbSuffix(baseUrl) + cfg.thumb.sizeSuffix.replace('{w}', String(w)).replace('{h}', String(h));
}
