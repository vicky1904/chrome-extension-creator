import { DEFAULT_CONFIG } from '@/config/default-config';
import type { AdapterConfig } from '@/config/schema';
import { validateConfig } from '@/config/validate';
import { BatchExecuteTransport } from '@/adapter/google/batchexecute';
import { GoogleAdapter } from '@/adapter/google/google-adapter';
import { readTokensFromDocument, type PageTokens } from '@/adapter/google/page-globals';
import { isAdapterMethod, type PhotosAdapter } from '@/adapter/types';
import { isMessage, ok, fail } from '@/shared/messages';
import { logger } from '@/shared/log';

const log = logger('content');

/**
 * Content script on photos.google.com. It is a thin relay: the service worker
 * asks for adapter calls over messaging and this script runs them with the
 * page's session cookies and XSRF tokens. No scanning logic lives here.
 */

let cfg: AdapterConfig = DEFAULT_CONFIG;
let tokens: PageTokens | null = null;
let adapter: PhotosAdapter | null = null;

function ensureAdapter(): PhotosAdapter {
  if (!tokens) {
    tokens = readTokensFromDocument(document, cfg);
    if (!tokens) throw new Error('Could not read page tokens. Is this photos.google.com and are you signed in?');
  }
  if (!adapter) {
    const transport = new BatchExecuteTransport({ cfg, tokens: () => tokens!, sourcePath: () => location.pathname });
    adapter = new GoogleAdapter(transport, cfg);
  }
  return adapter;
}

async function loadConfigFromStorage() {
  try {
    const stored = (await chrome.storage.local.get('adapterConfig')).adapterConfig;
    if (validateConfig(stored) && stored.revision >= DEFAULT_CONFIG.revision) {
      cfg = stored;
      adapter = null;
    }
  } catch (e) {
    log.warn('config read failed; using default', e);
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isMessage(msg)) return false;
  if (msg.type === 'adapter.ping') {
    sendResponse(ok({ hasTokens: !!readTokensFromDocument(document, cfg), href: location.href }));
    return false;
  }
  if (msg.type === 'adapter.call') {
    (async () => {
      await loadConfigFromStorage();
      if (!isAdapterMethod(msg.method)) throw new Error(`unknown adapter method ${msg.method}`);
      const a = ensureAdapter();
      const fn = a[msg.method] as (...args: unknown[]) => Promise<unknown>;
      try {
        return await fn.apply(a, msg.args);
      } catch (e) {
        // Stale tokens are the most common failure after Google refreshes the
        // page; drop them so the next call re-reads the DOM.
        tokens = null;
        adapter = null;
        throw e;
      }
    })()
      .then((v) => sendResponse(ok(v)))
      .catch((e) => sendResponse(fail(e)));
    return true;
  }
  return false;
});

log.info('content script ready');
