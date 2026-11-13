/**
 * Embedding model candidates, all published as transformers.js-ready ONNX on
 * the Hugging Face Hub. Sizes are approximate and must be verified in the
 * bake-off (docs/IMPLEMENTATION_PLAN.md, Milestone 3).
 *
 * Accuracy-first default: DINOv2-base. Self-supervised DINO features are the
 * strongest off-the-shelf signal for "same scene, different shot" grouping,
 * and the base model separates near-duplicates from merely similar scenes
 * noticeably better than the small variant. The model is downloaded once at
 * runtime and cached in the browser Cache Storage; it never leaves the device
 * and no image is ever sent anywhere.
 */

export type Device = 'webgpu' | 'wasm';
export type Dtype = 'fp32' | 'fp16' | 'q8' | 'int8' | 'q4' | 'q4f16';

export interface ModelSpec {
  id: string;
  hubId: string;
  family: 'dinov2' | 'dinov3' | 'mobileclip' | 'siglip';
  /**
   * Hub git revision. Pin to a commit hash after the bake-off so a model
   * update on the Hub cannot silently change which photos get grouped.
   */
  revision: string;
  dim: number;
  inputSize: number;
  /** Preferred dtype per device. */
  dtype: Record<Device, Dtype>;
  /** Approx download size in MB for the preferred WebGPU dtype. Verify. */
  approxSizeMb: Record<Device, number>;
  /** Starting cosine threshold for "similar"; calibrate per model. */
  defaultThreshold: number;
  notes: string;
}

export const MODELS: Record<string, ModelSpec> = {
  'dinov2-base': {
    id: 'dinov2-base',
    hubId: 'onnx-community/dinov2-base',
    revision: 'main',
    family: 'dinov2',
    dim: 768,
    inputSize: 224,
    dtype: { webgpu: 'fp16', wasm: 'q8' },
    approxSizeMb: { webgpu: 175, wasm: 90 },
    defaultThreshold: 0.88,
    notes: 'Accuracy-first default. 86M params. Strong image-to-image similarity.',
  },
  'dinov2-with-registers-base': {
    id: 'dinov2-with-registers-base',
    hubId: 'onnx-community/dinov2-with-registers-base',
    revision: 'main',
    family: 'dinov2',
    dim: 768,
    inputSize: 224,
    dtype: { webgpu: 'fp16', wasm: 'q8' },
    approxSizeMb: { webgpu: 175, wasm: 90 },
    defaultThreshold: 0.88,
    notes: 'Registers remove attention artifacts; often cleaner global features. Bake-off challenger.',
  },
  'dinov3-vitb16': {
    id: 'dinov3-vitb16',
    hubId: 'onnx-community/dinov3-vitb16-pretrain-lvd1689m-ONNX',
    revision: 'main',
    family: 'dinov3',
    dim: 768,
    inputSize: 224,
    dtype: { webgpu: 'fp16', wasm: 'q8' },
    approxSizeMb: { webgpu: 175, wasm: 90 },
    defaultThreshold: 0.88,
    notes: 'Newest DINO generation. Requires transformers.js >= 3.7.2. Bake-off challenger.',
  },
  'dinov2-small': {
    id: 'dinov2-small',
    hubId: 'onnx-community/dinov2-small',
    revision: 'main',
    family: 'dinov2',
    dim: 384,
    inputSize: 224,
    dtype: { webgpu: 'fp16', wasm: 'q8' },
    approxSizeMb: { webgpu: 45, wasm: 25 },
    defaultThreshold: 0.9,
    notes: 'Fallback for machines without WebGPU or with little memory. 22M params.',
  },
  'mobileclip-s2': {
    id: 'mobileclip-s2',
    hubId: 'Xenova/mobileclip_s2',
    revision: 'main',
    family: 'mobileclip',
    dim: 512,
    inputSize: 256,
    dtype: { webgpu: 'fp16', wasm: 'q8' },
    approxSizeMb: { webgpu: 70, wasm: 40 },
    defaultThreshold: 0.92,
    notes: 'CLIP-style; semantic rather than visual. Only if text search becomes a feature.',
  },
};

export const DEFAULT_MODEL_ID = 'dinov2-base';
export const FALLBACK_MODEL_ID = 'dinov2-small';

export function getModel(id: string): ModelSpec {
  const m = MODELS[id];
  if (!m) throw new Error(`unknown model ${id}`);
  return m;
}

/** Pick the model to use given hardware. Large model on WebGPU, small on WASM. */
export function chooseModel(preferredId: string, device: Device): ModelSpec {
  const preferred = getModel(preferredId);
  if (device === 'webgpu') return preferred;
  // On WASM, anything above ~100 MB is too slow to be useful for a 50k library.
  return preferred.approxSizeMb.wasm <= 100 ? preferred : getModel(FALLBACK_MODEL_ID);
}
