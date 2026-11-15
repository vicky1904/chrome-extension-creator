import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AuditLogEntry, Group, ItemAnalysis, ItemEmbedding, Job, MediaItem, Settings, StorageUsage, ReclaimableSummary } from '@/shared/types';

export interface CleanerDB extends DBSchema {
  items: {
    key: string;
    value: MediaItem;
    indexes: { byTakenAt: number; byStatus: string };
  };
  analyses: {
    key: string;
    value: ItemAnalysis;
  };
  embeddings: {
    key: string;
    value: ItemEmbedding;
    indexes: { byModel: string };
  };
  groups: {
    key: string;
    value: Group;
    indexes: { byKind: string };
  };
  jobs: {
    key: string;
    value: Job;
    indexes: { byState: string };
  };
  kv: {
    key: string;
    value: { key: string; value: unknown };
  };
  audit: {
    key: number;
    value: AuditLogEntry;
    indexes: { byAt: number };
  };
}

export const DB_NAME = 'photos-storage-cleaner';
export const DB_VERSION = 1;

export type Db = IDBPDatabase<CleanerDB>;

export function openCleanerDb(): Promise<Db> {
  return openDB<CleanerDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const items = db.createObjectStore('items', { keyPath: 'mediaKey' });
      items.createIndex('byTakenAt', 'takenAt');
      items.createIndex('byStatus', 'status');
      db.createObjectStore('analyses', { keyPath: 'mediaKey' });
      const emb = db.createObjectStore('embeddings', { keyPath: 'mediaKey' });
      emb.createIndex('byModel', 'modelId');
      const groups = db.createObjectStore('groups', { keyPath: 'id' });
      groups.createIndex('byKind', 'kind');
      const jobs = db.createObjectStore('jobs', { keyPath: 'id' });
      jobs.createIndex('byState', 'state');
      db.createObjectStore('kv', { keyPath: 'key' });
      const audit = db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
      audit.createIndex('byAt', 'at');
    },
  });
}

/** Typed keys for the kv store. */
export interface KvMap {
  settings: Settings;
  usage: StorageUsage;
  reclaimable: ReclaimableSummary;
  lastScanAt: number;
}
