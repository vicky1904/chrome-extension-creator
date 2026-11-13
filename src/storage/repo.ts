import type { AuditLogEntry, Group, ItemAnalysis, ItemEmbedding, Job, MediaItem, Settings } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/types';
import type { Db, KvMap } from './db';
import { openCleanerDb } from './db';

/**
 * Repository over IndexedDB. All writes are batched in single transactions;
 * per-item transactions dominate scan time otherwise.
 */
export class Repo {
  private constructor(private readonly db: Db) {}

  static async open(db?: Db): Promise<Repo> {
    return new Repo(db ?? (await openCleanerDb()));
  }

  /* items */

  async putItems(items: MediaItem[]): Promise<void> {
    const tx = this.db.transaction('items', 'readwrite');
    await Promise.all([...items.map((i) => tx.store.put(i)), tx.done]);
  }

  /**
   * Store items from a library listing. Listings carry no size or quota
   * info, so a rescan must keep what an earlier sizes pass fetched, and must
   * keep the user's protected flag.
   */
  async upsertListedItems(items: MediaItem[]): Promise<void> {
    const tx = this.db.transaction('items', 'readwrite');
    for (const fresh of items) {
      const cur = await tx.store.get(fresh.mediaKey);
      await tx.store.put(
        cur
          ? {
              ...fresh,
              sizeBytes: cur.sizeBytes,
              takesUpSpace: cur.takesUpSpace,
              spaceTakenBytes: cur.spaceTakenBytes,
              fileName: cur.fileName,
              uploadedAt: cur.uploadedAt ?? fresh.uploadedAt,
              protected: cur.protected || fresh.protected,
            }
          : fresh,
      );
    }
    await tx.done;
  }

  /** Merge partial updates (e.g. sizes) into existing items. */
  async patchItems(patches: (Partial<MediaItem> & { mediaKey: string })[]): Promise<number> {
    const tx = this.db.transaction('items', 'readwrite');
    let n = 0;
    for (const p of patches) {
      const cur = await tx.store.get(p.mediaKey);
      if (!cur) continue;
      await tx.store.put({ ...cur, ...p });
      n++;
    }
    await tx.done;
    return n;
  }

  getItem(mediaKey: string): Promise<MediaItem | undefined> {
    return this.db.get('items', mediaKey);
  }

  allItems(): Promise<MediaItem[]> {
    return this.db.getAll('items');
  }

  itemsByStatus(status: MediaItem['status']): Promise<MediaItem[]> {
    return this.db.getAllFromIndex('items', 'byStatus', status);
  }

  async itemsMissingSize(): Promise<MediaItem[]> {
    return (await this.allItems()).filter((i) => i.sizeBytes === null);
  }

  countItems(): Promise<number> {
    return this.db.count('items');
  }

  /* analyses */

  async putAnalyses(rows: ItemAnalysis[]): Promise<void> {
    const tx = this.db.transaction('analyses', 'readwrite');
    await Promise.all([...rows.map((r) => tx.store.put(r)), tx.done]);
  }

  async allAnalyses(): Promise<Map<string, ItemAnalysis>> {
    return new Map((await this.db.getAll('analyses')).map((a) => [a.mediaKey, a]));
  }

  /* embeddings */

  async putEmbeddings(rows: ItemEmbedding[]): Promise<void> {
    const tx = this.db.transaction('embeddings', 'readwrite');
    await Promise.all([...rows.map((r) => tx.store.put(r)), tx.done]);
  }

  async embeddingsForModel(modelId: string): Promise<Map<string, ItemEmbedding>> {
    return new Map((await this.db.getAllFromIndex('embeddings', 'byModel', modelId)).map((e) => [e.mediaKey, e]));
  }

  /* groups */

  async replaceGroups(groups: Group[]): Promise<void> {
    const tx = this.db.transaction('groups', 'readwrite');
    const existing = await tx.store.getAll();
    const decisions = new Map(existing.map((g) => [g.id, g]));
    await tx.store.clear();
    for (const g of groups) {
      const prev = decisions.get(g.id);
      await tx.store.put(prev ? { ...g, reviewed: prev.reviewed, decisions: prev.decisions } : g);
    }
    await tx.done;
  }

  allGroups(kind?: Group['kind']): Promise<Group[]> {
    return kind ? this.db.getAllFromIndex('groups', 'byKind', kind) : this.db.getAll('groups');
  }

  getGroup(id: string): Promise<Group | undefined> {
    return this.db.get('groups', id);
  }

  putGroup(g: Group): Promise<string> {
    return this.db.put('groups', g);
  }

  /* jobs */

  putJob(job: Job): Promise<string> {
    return this.db.put('jobs', job);
  }

  getJob(id: string): Promise<Job | undefined> {
    return this.db.get('jobs', id);
  }

  async activeJob(): Promise<Job | undefined> {
    const running = await this.db.getAllFromIndex('jobs', 'byState', 'running');
    if (running[0]) return running[0];
    const paused = await this.db.getAllFromIndex('jobs', 'byState', 'paused');
    if (paused[0]) return paused[0];
    return (await this.db.getAllFromIndex('jobs', 'byState', 'queued'))[0];
  }

  /* kv */

  async getKv<K extends keyof KvMap>(key: K): Promise<KvMap[K] | undefined> {
    return (await this.db.get('kv', key))?.value as KvMap[K] | undefined;
  }

  async setKv<K extends keyof KvMap>(key: K, value: KvMap[K]): Promise<void> {
    await this.db.put('kv', { key, value });
  }

  async getSettings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...((await this.getKv('settings')) ?? {}) };
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.getSettings()), ...patch };
    await this.setKv('settings', next);
    return next;
  }

  /* audit */

  async log(entry: Omit<AuditLogEntry, 'id'>): Promise<void> {
    await this.db.add('audit', entry as AuditLogEntry);
  }

  recentAudit(limit = 200): Promise<AuditLogEntry[]> {
    return this.db.getAllFromIndex('audit', 'byAt').then((rows) => rows.slice(-limit).reverse());
  }

  /* maintenance */

  async clearAll(): Promise<void> {
    for (const store of ['items', 'analyses', 'embeddings', 'groups', 'jobs', 'audit'] as const) {
      await this.db.clear(store);
    }
  }

  close() {
    this.db.close();
  }
}
