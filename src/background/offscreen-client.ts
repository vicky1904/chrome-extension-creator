import type { AnalyzeResult, EmbedResult, ModelStatus, Reply } from '@/shared/messages';

const OFFSCREEN_URL = 'offscreen.html';
let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] });
  if (contexts.length > 0) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['WORKERS' as chrome.offscreen.Reason, 'BLOBS' as chrome.offscreen.Reason],
        justification: 'Decode photo thumbnails and run on-device image similarity models.',
      })
      .finally(() => (creating = null));
  }
  await creating;
}

async function send<T>(msg: unknown): Promise<T> {
  await ensureOffscreen();
  const reply = (await chrome.runtime.sendMessage(msg)) as Reply<T> | undefined;
  if (!reply) throw new Error('offscreen document did not respond');
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export interface Analyzer {
  analyze(items: { mediaKey: string; thumbUrl: string }[]): Promise<AnalyzeResult[]>;
  embed(modelId: string, items: { mediaKey: string; thumbUrl: string }[]): Promise<EmbedResult[]>;
  modelStatus(modelId: string): Promise<ModelStatus>;
}

export const offscreenAnalyzer: Analyzer = {
  analyze: (items) => send<AnalyzeResult[]>({ type: 'offscreen.analyze', items }),
  embed: (modelId, items) => send<EmbedResult[]>({ type: 'offscreen.embed', modelId, items }),
  modelStatus: (modelId) => send<ModelStatus>({ type: 'offscreen.modelStatus', modelId }),
};

export async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    /* none open */
  }
}
