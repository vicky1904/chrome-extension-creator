import type { PhotosAdapter } from '@/adapter/types';
import { ADAPTER_METHODS } from '@/adapter/types';
import type { Reply } from '@/shared/messages';
import { logger } from '@/shared/log';

const log = logger('remote-adapter');
const PHOTOS_URL = 'https://photos.google.com/';

/**
 * PhotosAdapter implementation for the service worker that forwards every
 * call to the content script in a photos.google.com tab. If no such tab is
 * open, one is opened in the background (the user is told about this in
 * onboarding) and closed again when the job finishes.
 */
export class RemoteAdapter implements PhotosAdapter {
  readonly name = 'google' as const;
  private tabId: number | null = null;
  private openedByUs = false;

  listItems!: PhotosAdapter['listItems'];
  listTrash!: PhotosAdapter['listTrash'];
  listFavorites!: PhotosAdapter['listFavorites'];
  getMediaInfo!: PhotosAdapter['getMediaInfo'];
  getStorageUsage!: PhotosAdapter['getStorageUsage'];
  getDownloadInfo!: PhotosAdapter['getDownloadInfo'];
  trashItems!: PhotosAdapter['trashItems'];
  restoreItems!: PhotosAdapter['restoreItems'];
  selfTest!: PhotosAdapter['selfTest'];

  constructor() {
    for (const m of ADAPTER_METHODS) {
      (this as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => this.call(m, args);
    }
  }

  private async call(method: string, args: unknown[]): Promise<any> {
    const tabId = await this.ensureTab();
    const reply = (await chrome.tabs.sendMessage(tabId, { type: 'adapter.call', method, args })) as Reply<unknown> | undefined;
    if (!reply) throw new Error('No response from the Google Photos tab. Reload photos.google.com and try again.');
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  }

  async ensureTab(): Promise<number> {
    if (this.tabId !== null) {
      try {
        await chrome.tabs.get(this.tabId);
        return this.tabId;
      } catch {
        this.tabId = null;
      }
    }
    const existing = await chrome.tabs.query({ url: 'https://photos.google.com/*' });
    const ready = existing.find((t) => t.status === 'complete') ?? existing[0];
    if (ready?.id !== undefined) {
      this.tabId = ready.id;
      this.openedByUs = false;
      return ready.id;
    }
    log.info('opening photos.google.com in a background tab');
    const tab = await chrome.tabs.create({ url: PHOTOS_URL, active: false });
    this.tabId = tab.id!;
    this.openedByUs = true;
    await waitForTabComplete(tab.id!);
    await waitForContentScript(tab.id!);
    return tab.id!;
  }

  async releaseTab() {
    if (this.tabId !== null && this.openedByUs) {
      try {
        await chrome.tabs.remove(this.tabId);
      } catch {
        /* already closed */
      }
    }
    this.tabId = null;
    this.openedByUs = false;
  }
}

function waitForTabComplete(tabId: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Google Photos tab did not finish loading'));
    }, timeoutMs);
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForContentScript(tabId: number, attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = (await chrome.tabs.sendMessage(tabId, { type: 'adapter.ping' })) as Reply<{ hasTokens: boolean }> | undefined;
      if (r?.ok && r.value.hasTokens) return;
    } catch {
      /* not injected yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Content script did not become ready on photos.google.com. Are you signed in?');
}
