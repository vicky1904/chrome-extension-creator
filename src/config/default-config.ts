import type { AdapterConfig } from './schema';

/**
 * Default adapter config, derived from the publicly documented batchexecute
 * protocol and the MIT-licensed Google Photos Toolkit's reverse engineering
 * (see NOTICE.md). Treat every value as "observed", not guaranteed. Milestone 0
 * verifies each against the live page on the test account.
 */
export const DEFAULT_CONFIG: AdapterConfig = {
  schemaVersion: 1,
  revision: 1,
  minExtensionVersion: '0.1.0',

  transport: {
    endpointSuffix: 'data/batchexecute',
    globalName: 'WIZ_global_data',
    globals: { at: 'SNlM0e', sid: 'FdrFJe', bl: 'cfb2h', path: 'eptZe', rapt: 'Dbw5Ud' },
    maxRetries: 3,
    retryBaseDelayMs: 2000,
    concurrency: 2,
    minIntervalMs: 250,
  },

  rpc: {
    listByTakenDate: { id: 'lcxiM' },
    listByUploadedDate: { id: 'EzkLib' },
    favorites: { id: 'EzkLib' },
    trashList: { id: 'zy0IHe' },
    trashOrRestore: { id: 'XwAOJf' },
    batchMediaInfo: { id: 'EWgK9e' },
    itemInfo: { id: 'VrseUb' },
    itemInfoExt: { id: 'fDcn4b' },
    storageQuota: { id: 'EzwWhf' },
    downloadUrl: { id: 'pLFTfd' },
    downloadToken: { id: 'yCLA7' },
    checkDownloadToken: { id: 'dnv2s' },
    albums: { id: 'Z5xsfc' },
    albumPage: { id: 'snAcKc' },
  },

  limits: {
    listPageSize: 500,
    mediaInfoBatch: 500,
    trashBatch: 250,
  },

  paths: {
    listPage: { items: [0], nextPageId: [1] },
    item: {
      mediaKey: [0],
      dedupKey: [3],
      timestamp: [2],
      timezoneOffset: [4],
      creationTimestamp: [5],
      thumb: [1, 0],
      width: [1, 1],
      height: [1, 2],
      isArchived: [13],
      partialUploadMarker: [12, 0],
      isFavorite: ['ext', '163238866', 0],
      durationMs: ['ext', '76647426', 0],
      livePhoto: ['ext', '146008172'],
    },
    mediaInfo: {
      rows: [0, 1],
      rowKey: [0],
      fileName: [1, 3],
      timestamp: [1, 6],
      size: [1, 9],
      quotaBag: [1, -1],
      takesUpSpace: [0],
      spaceTaken: [1],
    },
    quota: { used: [6, 0], limit: [6, 1], usedByPhotos: [6, 3] },
    trashPage: { items: [0], nextPageId: [1] },
  },

  thumb: {
    sizeSuffix: '=w{w}-h{h}-no',
  },
};
