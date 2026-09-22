import { useActivePicture, useStudio } from "@/lib/studio/store";
import type { Dispatch, SetStateAction } from "react";
/** Draft buffers share project persistence but are excluded from executable source snapshots. */
export function useWorkspaceDraft<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const picture = useActivePicture();
  const value = (picture?.editorDrafts?.[key] as T | undefined) ?? initial;
  const set: Dispatch<SetStateAction<T>> = (change) => {
    const latest = useStudio.getState().pictures.find((p) => p.id === picture?.id);
    if (!latest) return;
    const previous = (latest.editorDrafts?.[key] as T | undefined) ?? initial;
    const next = typeof change === "function" ? (change as (v: T) => T)(previous) : change;
    useStudio
      .getState()
      .replaceActive({ ...latest, editorDrafts: { ...latest.editorDrafts, [key]: next } });
  };
  return [value, set];
}
