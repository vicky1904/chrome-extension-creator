import { env, pipeline, RawImage, type ImageFeatureExtractionPipeline } from '@huggingface/transformers';
import { l2normalize } from '../similarity';
import type { Device, ModelSpec } from './model-registry';
import { logger } from '@/shared/log';

const log = logger('embedder');

export interface EmbedderStatus {
  state: 'not-loaded' | 'downloading' | 'ready' | 'error';
  device: Device | null;
  progress: number;
  error?: string;
}

export async function detectDevice(): Promise<Device> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return 'wasm';
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

/**
 * Wraps a transformers.js image-feature-extraction pipeline. One instance per
 * model, kept alive in the offscreen document for the whole job.
 */
export class Embedder {
  private pipe: ImageFeatureExtractionPipeline | null = null;
  status: EmbedderStatus = { state: 'not-loaded', device: null, progress: 0 };

  constructor(
    readonly spec: ModelSpec,
    private readonly device: Device,
  ) {}

  /**
   * Must run before the first pipeline() call. Model weights (data) are
   * fetched from the Hub once and cached; the ONNX runtime itself (code) is
   * bundled with the extension. Without the wasmPaths override transformers.js
   * would load the runtime from a CDN, which MV3 forbids as remote code.
   */
  static configureEnv(runtime: { mjs: string; wasm: string }) {
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    const wasm = env.backends?.onnx?.wasm as { wasmPaths?: unknown } | undefined;
    if (wasm) wasm.wasmPaths = { mjs: runtime.mjs, wasm: runtime.wasm };
  }

  async load(): Promise<void> {
    if (this.pipe) return;
    this.status = { state: 'downloading', device: this.device, progress: 0 };
    try {
      this.pipe = await pipeline('image-feature-extraction', this.spec.hubId, {
        device: this.device,
        revision: this.spec.revision,
        dtype: this.spec.dtype[this.device],
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (typeof p.progress === 'number') this.status.progress = p.progress / 100;
        },
      });
      this.status = { state: 'ready', device: this.device, progress: 1 };
      log.info(`model ${this.spec.id} ready on ${this.device}`);
    } catch (e) {
      this.status = { state: 'error', device: this.device, progress: 0, error: e instanceof Error ? e.message : String(e) };
      throw e;
    }
  }

  /** Embed one decoded image. Returns an L2-normalised Float32 vector. */
  async embed(image: RawImage): Promise<Float32Array> {
    if (!this.pipe) await this.load();
    // pool: true averages patch tokens into one vector; works across DINO and CLIP vision towers.
    const out = await this.pipe!(image, { pool: true });
    const data = out.data as Float32Array | Float16Array | number[];
    return l2normalize(Float32Array.from(data as ArrayLike<number>));
  }

  async embedBlob(blob: Blob): Promise<Float32Array> {
    const img = await RawImage.fromBlob(blob);
    return this.embed(img);
  }

  dispose() {
    this.pipe?.dispose?.();
    this.pipe = null;
    this.status = { state: 'not-loaded', device: null, progress: 0 };
  }
}

type Float16Array = { length: number; [i: number]: number };
