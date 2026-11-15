import type { DedupKey, MediaItem, MediaKey, StorageUsage } from '@/shared/types';
import type { DownloadInfo, ListPage, MediaInfo, PhotosAdapter, SelfTestReport, TrashResult } from '../types';
import { FIXTURE_ITEMS, FIXTURE_USAGE } from './fixtures';

export interface MockOptions {
  items?: MediaItem[];
  pageSize?: number;
  /** Simulated latency per call in ms. */
  latencyMs?: number;
  /** Throw on every Nth call to exercise retry/pause paths. */
  failEvery?: number;
}

/** In-memory adapter over fixture data. Trash/restore mutate state so jobs can be tested end to end. */
export class MockAdapter implements PhotosAdapter {
  readonly name = 'mock' as const;
  private readonly items: Map<MediaKey, MediaItem>;
  private readonly pageSize: number;
  private calls = 0;
  readonly trashCalls: DedupKey[][] = [];

  constructor(private readonly opts: MockOptions = {}) {
    this.items = new Map((opts.items ?? FIXTURE_ITEMS).map((i) => [i.mediaKey, structuredClone(i)]));
    this.pageSize = opts.pageSize ?? 6;
  }

  private async tick() {
    this.calls++;
    if (this.opts.failEvery && this.calls % this.opts.failEvery === 0) throw new Error(`mock failure on call ${this.calls}`);
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
  }

  private page(list: MediaItem[], pageId: string | null): ListPage {
    const start = pageId ? Number(pageId) : 0;
    const slice = list.slice(start, start + this.pageSize);
    const next = start + this.pageSize < list.length ? String(start + this.pageSize) : null;
    // Listing never exposes size info; that comes from getMediaInfo, as on Google.
    return { items: slice.map((i) => ({ ...i, sizeBytes: null, takesUpSpace: null, spaceTakenBytes: null, fileName: null })), nextPageId: next };
  }

  async listItems(pageId: string | null): Promise<ListPage> {
    await this.tick();
    const live = [...this.items.values()].filter((i) => i.status === 'cloud').sort((a, b) => b.takenAt - a.takenAt);
    return this.page(live, pageId);
  }

  async listTrash(pageId: string | null): Promise<ListPage> {
    await this.tick();
    return this.page([...this.items.values()].filter((i) => i.status === 'trashed'), pageId);
  }

  async listFavorites(pageId: string | null): Promise<ListPage> {
    await this.tick();
    return this.page([...this.items.values()].filter((i) => i.isFavorite && i.status === 'cloud'), pageId);
  }

  async getMediaInfo(mediaKeys: MediaKey[]): Promise<MediaInfo[]> {
    await this.tick();
    return mediaKeys.flatMap((k) => {
      const i = this.items.get(k);
      return i ? [{ mediaKey: k, fileName: i.fileName, sizeBytes: i.sizeBytes, takesUpSpace: i.takesUpSpace, spaceTakenBytes: i.spaceTakenBytes, uploadedAt: i.uploadedAt }] : [];
    });
  }

  async getStorageUsage(): Promise<StorageUsage> {
    await this.tick();
    const trashedFreed = 0; // Trash still counts on Google until emptied.
    return { ...FIXTURE_USAGE, usedBytes: FIXTURE_USAGE.usedBytes - trashedFreed, fetchedAt: Date.now() };
  }

  async getDownloadInfo(mediaKey: MediaKey): Promise<DownloadInfo> {
    await this.tick();
    const i = this.items.get(mediaKey);
    if (!i) throw new Error('unknown item');
    return { url: `mock://download/${mediaKey}`, originalUrl: `mock://download/${mediaKey}?orig`, livePhotoVideoUrl: i.isLivePhoto ? `mock://download/${mediaKey}.mov` : null };
  }

  async trashItems(dedupKeys: DedupKey[]): Promise<TrashResult> {
    await this.tick();
    this.trashCalls.push([...dedupKeys]);
    for (const i of this.items.values()) if (i.dedupKey && dedupKeys.includes(i.dedupKey)) i.status = 'trashed';
    return { requested: dedupKeys.length, accepted: true };
  }

  async restoreItems(dedupKeys: DedupKey[]): Promise<TrashResult> {
    await this.tick();
    for (const i of this.items.values()) if (i.dedupKey && dedupKeys.includes(i.dedupKey)) i.status = 'cloud';
    return { requested: dedupKeys.length, accepted: true };
  }

  async selfTest(): Promise<SelfTestReport> {
    return { ok: true, checks: [{ name: 'mock adapter', ok: true }], ranAt: Date.now() };
  }

  /** Test helper. */
  statusOf(mediaKey: MediaKey) {
    return this.items.get(mediaKey)?.status;
  }
}
