import { useState } from "react";
import { toast } from "sonner";
import type { NativeGenerationValues } from "./engine-controls.ts";

/**
 * Legacy shot still hook retained only so older UI imports compile.
 * Wave 4 generation is prepared-asset-only and is authorized through the
 * desktop image bridge; this hook never wakes a model or mutates shot.stillUrl.
 */
export function useDirector() {
  const [busy, setBusy] = useState<string | null>(null);

  async function exposeStill(_input: {
    shotId: string;
    engineId: string;
    engineName: string;
    prompt: string;
    references: string[];
    selectedBasePath: string;
    values: NativeGenerationValues;
  }) {
    setBusy(null);
    toast.error("Shot still generation is disabled. Use Generate with an approved prepared asset.");
    return false;
  }

  return { busy, exposeStill };
}
