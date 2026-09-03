import { useState } from "react";
import { toast } from "sonner";
import { desktopExposeStill } from "@/lib/desktop/client";
import { useActivePicture, useStudio } from "./store";
import { USAGE_CAPS } from "./types";
import type { NativeGenerationValues } from "./engine-controls.ts";

/**
 * User-initiated local still generation.
 *
 * Screenplay generation has its own LM Studio job flow. Motion, voice, score,
 * and general director chat intentionally expose no hosted fallback here.
 */
export function useDirector() {
  const picture = useActivePicture();
  const bumpUsage = useStudio((state) => state.bumpUsage);
  const patchActive = useStudio((state) => state.patchActive);
  const [busy, setBusy] = useState<string | null>(null);

  async function exposeStill(input: {
    shotId: string;
    engineId: string;
    engineName: string;
    prompt: string;
    references: string[];
    selectedBasePath: string;
    values: NativeGenerationValues;
  }) {
    if (!picture) return false;
    const shot = picture.shots.find((item) => item.id === input.shotId);
    if (!shot) return false;
    if (picture.usage.stills >= USAGE_CAPS.stills) {
      toast.error(`Still cap reached (${USAGE_CAPS.stills}).`);
      return false;
    }

    setBusy(`still:${input.shotId}`);
    try {
      const result = await desktopExposeStill({
        prompt: input.prompt.trim() || shot.t2iPrompt || shot.description,
        engineId: input.engineId,
        engineName: input.engineName,
        references: input.references.slice(0, 3),
        selectedBasePath: input.selectedBasePath,
        values: input.values,
      });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      if (!bumpUsage("stills")) {
        toast.error(`Still cap reached (${USAGE_CAPS.stills}).`);
        return false;
      }
      patchActive({
        shots: picture.shots.map((item) => item.id === input.shotId
          ? { ...item, stillUrl: result.url, t2iPrompt: input.prompt.trim() }
          : item),
      });
      toast.success("Plate in from the local bay.");
      return result;
    } finally {
      setBusy(null);
    }
  }

  return { busy, exposeStill };
}
