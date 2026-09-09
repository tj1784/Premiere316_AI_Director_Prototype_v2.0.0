import { join } from "node:path";

export const KREA2_ROOT = "D:\\Projects\\krea-2";
export const KREA2_SOURCE_HEAD = "db3984fbc6e13b34c0064990fc2d95ac64d00058";
export const KREA2_COMPONENTS = {
  transformer: { role: "transformer", id: "krea2_raw_bf16.safetensors@f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7", path: "D:\\AI\\Models\\diffusion_models\\Krea 2\\krea2_raw_bf16.safetensors", sizeBytes: 26_283_332_608 },
  encoder: { role: "text_encoder", id: "qwen3vl_4b_bf16.safetensors@36f3ff447ef59201722e8f9ce6020c9819fdcfba6aa2608c4e09b1c0ce114e34", path: "D:\\AI\\Models\\text_encoders\\Qwen3-VL-4B\\qwen3vl_4b_bf16.safetensors", sizeBytes: 8_875_719_384 },
  vae: { role: "vae", id: "krea2RealVae_v10.safetensors@0dbbe0baeca04c2b98d2f3809c6f595608939809c88b695ba971368f17c874b8", path: "D:\\AI\\Models\\vae\\Krea 2\\krea2RealVae_v10.safetensors", sizeBytes: 507_591_212 },
  encoderConfig: { role: "processor", id: "Premiere316:krea2:qwen3-vl-4b-config-tokenizer", path: join(KREA2_ROOT, "local-components", "qwen3-vl-4b") },
  vaeConfig: { role: "vae_config", id: "Premiere316:krea2:qwen-image-vae-config", path: join(KREA2_ROOT, "local-components", "qwen-image-vae") },
  runtime: { role: "runtime", id: `krea-ai/krea-2@${KREA2_SOURCE_HEAD}`, path: KREA2_ROOT },
} as const;
