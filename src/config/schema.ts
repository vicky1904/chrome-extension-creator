/**
 * Versioned adapter configuration. Everything Google-specific that is likely
 * to change (RPC ids, response index paths, URL parameters, batch limits)
 * lives here so it can be refreshed from a remote JSON file without a store
 * review. Only configuration data is remote; never code.
 *
 * Path syntax: an array of steps applied in order to the parsed response.
 *   number  -> array index (negative counts from the end, like Array.at)
 *   string  -> object key (Google ext objects use numeric-string keys)
 *   'ext'   -> find the first element of the current array that is a
 *              non-null object (Google's "extension" bag at the tail)
 */
export type PathStep = number | string | 'ext';
export type Path = PathStep[];

export interface RpcSpec {
  /** batchexecute rpcid, e.g. "lcxiM". */
  id: string;
}

export interface AdapterConfig {
  /** Bump on any breaking change to shape. */
  schemaVersion: 1;
  /** Monotonic config revision for remote refresh. */
  revision: number;
  /** Oldest extension version this config is valid for. */
  minExtensionVersion: string;

  transport: {
    /** Appended after the page's base path, e.g. "data/batchexecute". */
    endpointSuffix: string;
    /** Global object on the page holding tokens. */
    globalName: string;
    /** Keys inside that global. */
    globals: { at: string; sid: string; bl: string; path: string; rapt: string };
    maxRetries: number;
    retryBaseDelayMs: number;
    /** Max concurrent batchexecute requests. */
    concurrency: number;
    /** Minimum gap between requests, to avoid hammering Google. */
    minIntervalMs: number;
  };

  rpc: {
    listByTakenDate: RpcSpec;
    listByUploadedDate: RpcSpec;
    favorites: RpcSpec;
    trashList: RpcSpec;
    trashOrRestore: RpcSpec;
    batchMediaInfo: RpcSpec;
    itemInfo: RpcSpec;
    itemInfoExt: RpcSpec;
    storageQuota: RpcSpec;
    downloadUrl: RpcSpec;
    downloadToken: RpcSpec;
    checkDownloadToken: RpcSpec;
    albums: RpcSpec;
    albumPage: RpcSpec;
  };

  limits: {
    listPageSize: number;
    /** Items per batchMediaInfo request. */
    mediaInfoBatch: number;
    /** Dedup keys per trash/restore request. */
    trashBatch: number;
  };

  paths: {
    listPage: { items: Path; nextPageId: Path };
    item: {
      mediaKey: Path;
      dedupKey: Path;
      timestamp: Path;
      timezoneOffset: Path;
      creationTimestamp: Path;
      thumb: Path;
      width: Path;
      height: Path;
      isArchived: Path;
      partialUploadMarker: Path;
      isFavorite: Path;
      durationMs: Path;
      livePhoto: Path;
    };
    mediaInfo: {
      rows: Path;
      rowKey: Path;
      fileName: Path;
      timestamp: Path;
      size: Path;
      quotaBag: Path;
      takesUpSpace: Path;
      spaceTaken: Path;
    };
    quota: { used: Path; limit: Path; usedByPhotos: Path };
    trashPage: { items: Path; nextPageId: Path };
  };

  thumb: {
    /** Template appended to a thumbnail URL; {w} and {h} are replaced. */
    sizeSuffix: string;
  };
}
