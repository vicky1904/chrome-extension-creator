import type { AdapterConfig } from '@/config/schema';
import type { DedupKey, MediaKey, StorageUsage } from '@/shared/types';
import type { DownloadInfo, ListPage, MediaInfo, PhotosAdapter, SelfTestReport, TrashResult } from '../types';
import type { Transport } from './batchexecute';
import { parseListPage, parseMediaInfo, parseStorageQuota, parseTrashPage } from './parsers';

/**
 * Live Google Photos adapter. Runs inside the content script on
 * photos.google.com so requests carry the user's session cookies.
 *
 * Argument arrays below are the observed shapes of the Photos web app's own
 * calls. They are data, held here rather than in config because changing them
 * usually also changes the response shape, which needs a code change anyway.
 */
export class GoogleAdapter implements PhotosAdapter {
  readonly name = 'google' as const;

  constructor(
    private readonly transport: Transport,
    private readonly cfg: AdapterConfig,
  ) {}

  async listItems(pageId: string | null): Promise<ListPage> {
    // [pageId, timestamp, pageSize, null, 1, source] where source 1 = library.
    const payload = await this.transport.call(this.cfg.rpc.listByTakenDate.id, [
      pageId,
      null,
      this.cfg.limits.listPageSize,
      null,
      1,
      1,
    ]);
    return parseListPage(payload, this.cfg);
  }

  async listTrash(pageId: string | null): Promise<ListPage> {
    const payload = await this.transport.call(this.cfg.rpc.trashList.id, [pageId]);
    return parseTrashPage(payload, this.cfg);
  }

  async listFavorites(pageId: string | null): Promise<ListPage> {
    const payload = await this.transport.call(this.cfg.rpc.favorites.id, ['Favorites', [[5, '8', 0, 9]], pageId]);
    return parseListPage(payload, this.cfg);
  }

  async getMediaInfo(mediaKeys: MediaKey[]): Promise<MediaInfo[]> {
    const out: MediaInfo[] = [];
    const batch = this.cfg.limits.mediaInfoBatch;
    for (let i = 0; i < mediaKeys.length; i += batch) {
      const keys = mediaKeys.slice(i, i + batch).map((k) => [k]);
      // Fixed field-mask template observed in the web app's own request.
      const mask = [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, [], null, null, null, null, null, null, null, null, null, null, null, []];
      const payload = await this.transport.call(this.cfg.rpc.batchMediaInfo.id, [[[keys]], [mask]]);
      out.push(...parseMediaInfo(payload, this.cfg));
    }
    return out;
  }

  async getStorageUsage(): Promise<StorageUsage> {
    const payload = await this.transport.call(this.cfg.rpc.storageQuota.id, []);
    return parseStorageQuota(payload, this.cfg);
  }

  async getDownloadInfo(mediaKey: MediaKey): Promise<DownloadInfo> {
    const payload = (await this.transport.call(this.cfg.rpc.itemInfo.id, [mediaKey, null, null, null, null])) as unknown[];
    const url = typeof payload?.[1] === 'string' ? (payload[1] as string) : null;
    const original = typeof payload?.[7] === 'string' ? (payload[7] as string) : null;
    if (!url && !original) throw new Error('no download URL in item info');
    return { url: (original ?? url) as string, originalUrl: original, livePhotoVideoUrl: null };
  }

  async trashItems(dedupKeys: DedupKey[]): Promise<TrashResult> {
    return this.trashOrRestore(dedupKeys, 'trash');
  }

  async restoreItems(dedupKeys: DedupKey[]): Promise<TrashResult> {
    return this.trashOrRestore(dedupKeys, 'restore');
  }

  private async trashOrRestore(dedupKeys: DedupKey[], mode: 'trash' | 'restore'): Promise<TrashResult> {
    const batch = this.cfg.limits.trashBatch;
    for (let i = 0; i < dedupKeys.length; i += batch) {
      const chunk = dedupKeys.slice(i, i + batch);
      // trash: [null, 1, keys, 3]   restore: [null, 3, keys, 2]
      const args = mode === 'trash' ? [null, 1, chunk, 3] : [null, 3, chunk, 2];
      await this.transport.call(this.cfg.rpc.trashOrRestore.id, args);
    }
    return { requested: dedupKeys.length, accepted: true };
  }

  async selfTest(): Promise<SelfTestReport> {
    const checks: SelfTestReport['checks'] = [];
    const run = async (name: string, fn: () => Promise<string | void>) => {
      try {
        const detail = await fn();
        checks.push({ name, ok: true, detail: detail ?? undefined });
      } catch (e) {
        checks.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    };
    await run('storage quota parses', async () => {
      const u = await this.getStorageUsage();
      if (u.limitBytes <= 0 || u.usedBytes < 0) throw new Error('implausible quota numbers');
      return `${u.usedBytes}/${u.limitBytes}`;
    });
    let firstKey: string | null = null;
    await run('library page parses', async () => {
      const page = await this.listItems(null);
      if (page.items.length === 0) throw new Error('first page returned no items');
      firstKey = page.items[0]!.mediaKey;
      return `${page.items.length} items, next=${page.nextPageId ? 'yes' : 'no'}`;
    });
    await run('media info parses', async () => {
      if (!firstKey) throw new Error('skipped: no item to query');
      const info = await this.getMediaInfo([firstKey]);
      if (info.length !== 1 || info[0]!.sizeBytes === null) throw new Error('size missing');
      return `size=${info[0]!.sizeBytes} takesUpSpace=${info[0]!.takesUpSpace}`;
    });
    return { ok: checks.every((c) => c.ok), checks, ranAt: Date.now() };
  }
}
