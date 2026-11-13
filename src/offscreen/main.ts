import { Embedder, detectDevice } from '@/ml/embedding/embedder';
import { chooseModel } from '@/ml/embedding/model-registry';
import { isMessage, ok, fail, type AnalyzeResult, type EmbedResult, type ModelStatus } from '@/shared/messages';
import { analyzeThumb, fetchDecoded } from './thumbnails';
import { logger } from '@/shared/log';
// Bundled ONNX runtime (code ships in the package; MV3 forbids remote code).
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

const log = logger('offscreen');

/**
 * Offscreen document: the only place with both a DOM (OffscreenCanvas,
 * createImageBitmap) and WebGPU. The service worker sends batches of
 * thumbnails here for hashing and embedding and we keep the model warm.
 */

Embedder.configureEnv({ mjs: new URL(ortMjsUrl, location.href).href, wasm: new URL(ortWasmUrl, location.href).href });

let embedder: Embedder | null = null;
let devicePromise: Promise<'webgpu' | 'wasm'> | null = null;

async function getEmbedder(modelId: string): Promise<Embedder> {
  devicePromise ??= detectDevice();
  const device = await devicePromise;
  const spec = chooseModel(modelId, device);
  if (embedder && embedder.spec.id === spec.id) return embedder;
  embedder?.dispose();
  embedder = new Embedder(spec, device);
  await embedder.load();
  return embedder;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isMessage(msg)) return false;
  switch (msg.type) {
    case 'offscreen.analyze': {
      mapLimit(msg.items, 6, (it) => analyzeThumb(it.mediaKey, it.thumbUrl))
        .then((r: AnalyzeResult[]) => sendResponse(ok(r)))
        .catch((e) => sendResponse(fail(e)));
      return true;
    }
    case 'offscreen.embed': {
      (async () => {
        const emb = await getEmbedder(msg.modelId);
        const results: EmbedResult[] = await mapLimit(msg.items, 2, async (it) => {
          try {
            const { blob } = await fetchDecoded(it.thumbUrl, emb.spec.inputSize);
            const v = await emb.embedBlob(blob);
            return { mediaKey: it.mediaKey, vector: Array.from(v) };
          } catch (e) {
            return { mediaKey: it.mediaKey, vector: null, error: e instanceof Error ? e.message : String(e) };
          }
        });
        sendResponse(ok(results));
      })().catch((e) => {
        log.error('embed batch failed', e);
        sendResponse(fail(e));
      });
      return true;
    }
    case 'offscreen.modelStatus': {
      const s: ModelStatus = embedder
        ? { modelId: embedder.spec.id, state: embedder.status.state, device: embedder.status.device, progress: embedder.status.progress, error: embedder.status.error }
        : { modelId: msg.modelId, state: 'not-loaded', device: null, progress: 0 };
      sendResponse(ok(s));
      return false;
    }
    default:
      return false;
  }
});

log.info('offscreen document ready');
