import { existsSync } from "node:fs";
import { join } from "node:path";

/** Support the original flat vault and the user's organized family folders.
 * The caller still verifies the exact checkpoint size and cryptographic hash.
 */
export function nativeModelPath(root: string, category: string, family: string, filename: string): string {
  const flat = join(root, category, filename);
  const organized = join(root, category, family, filename);
  return existsSync(flat) ? flat : existsSync(organized) ? organized : flat;
}

const ROOT = "D:\\AI\\Models";
export const NATIVE_STILL_MODEL_PATHS = {
  flux1: nativeModelPath(ROOT, "diffusion_models", "Flux.1", "flux1-dev.safetensors"),
  flux1Vae: nativeModelPath(ROOT, "vae", "Flux.1", "ae.safetensors"),
  flux2: nativeModelPath(ROOT, "diffusion_models", "flux2", "flux2_dev.safetensors"),
  flux2Vae: nativeModelPath(ROOT, "vae", "flux2", "flux2-vae.safetensors"),
};
