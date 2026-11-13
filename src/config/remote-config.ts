import { DEFAULT_CONFIG } from './default-config';
import type { AdapterConfig } from './schema';
import { compareVersions, validateConfig } from './validate';
import { logger } from '@/shared/log';

const log = logger('config');
const STORAGE_KEY = 'adapterConfig';

/**
 * URL of the remote config file. Must be a static JSON file on a host the
 * owner controls. Empty string disables remote refresh (default until the
 * owner provides a host). The URL is intentionally not Google's.
 */
export const REMOTE_CONFIG_URL = '';

export async function loadConfig(): Promise<AdapterConfig> {
  try {
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if (validateConfig(stored) && stored.revision >= DEFAULT_CONFIG.revision) return stored;
  } catch (e) {
    log.warn('stored config unreadable, using default', e);
  }
  return DEFAULT_CONFIG;
}

export async function refreshConfig(extensionVersion: string, fetchImpl: typeof fetch = fetch): Promise<AdapterConfig> {
  if (!REMOTE_CONFIG_URL) return loadConfig();
  try {
    const res = await fetchImpl(REMOTE_CONFIG_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    if (!validateConfig(json)) throw new Error('remote config failed validation');
    if (compareVersions(extensionVersion, json.minExtensionVersion) < 0) {
      log.info('remote config requires newer extension; keeping current');
      return loadConfig();
    }
    const current = await loadConfig();
    if (json.revision <= current.revision) return current;
    await chrome.storage.local.set({ [STORAGE_KEY]: json });
    log.info('adapter config updated to revision', json.revision);
    return json;
  } catch (e) {
    log.warn('remote config refresh failed', e);
    return loadConfig();
  }
}
