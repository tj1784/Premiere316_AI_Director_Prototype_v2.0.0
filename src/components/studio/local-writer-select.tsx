import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assetGenerationRuns } from "@/lib/studio/asset-generation-runs";
import { explicitMoviePlanServedId } from "@/lib/studio/movie-plan-model";
import { localWriterOptions } from "@/lib/studio/local-writer-options";
import { localLLMStatus } from "@/lib/studio/screenplay-client";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";

export function LocalWriterSelect({ picture, disabled = false, label }: { picture: Picture; disabled?: boolean; label: string }) {
  const [options, setOptions] = useState<ReturnType<typeof localWriterOptions>>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const patchActive = useStudio((state) => state.patchActive);
  const assetsRunning = useSyncExternalStore(assetGenerationRuns.subscribe, () => assetGenerationRuns.get(picture.id)?.status === "running", () => false);
  const selectedId = (explicitMoviePlanServedId(picture) ?? "").trim().replace(/^lmstudio:/i, "");
  const selected = options.find((option) => option.id === selectedId);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setRefreshing(true);
    setError("");
    try {
      const status = await localLLMStatus();
      if (current !== request.current) return;
      setOptions(localWriterOptions(status));
      if (!status.provider.available) setError(status.provider.reason);
    } catch (error) {
      if (current === request.current) setError(error instanceof Error ? error.message : "Could not refresh local models.");
    } finally {
      if (current === request.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => { request.current++; };
  }, [refresh]);

  return <div className="grid min-w-0 max-w-full gap-2 text-sm">
    <label className="grid min-w-0 gap-2">Local text model
      <select aria-label={label} className="min-h-11 w-full min-w-0 max-w-full rounded-md border border-edge bg-inset px-3 text-fg" value={selectedId} disabled={disabled || assetsRunning} onChange={(event) => {
        const option = options.find((item) => item.id === event.target.value);
        if (!option) return;
        patchActive({ screenplay: { ...picture.screenplay, selectedModelId: `lmstudio:${option.id}`, pinnedWriterServedId: option.id, updatedAt: Date.now() } });
      }}>
        {!selected ? <option value={selectedId}>{selectedId || "Choose a local model"}{refreshing ? " · Checking…" : " · Not available"}</option> : null}
        {options.map((option) => <option key={option.id} value={option.id}>{option.displayName} · {option.loaded ? "Loaded" : "Load on generation"}</option>)}
      </select>
    </label>
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
      <p className="min-w-0 flex-1 break-all text-muted">Selected: {selectedId || "None"}{selected ? selected.loaded ? " · Loaded" : " · Loads when generation starts" : ""}</p>
      <Button className="min-h-11 shrink-0" size="sm" variant="secondary" aria-label={`Refresh ${label.toLowerCase()} models`} disabled={refreshing || disabled || assetsRunning} onClick={() => void refresh()}><RefreshCw aria-hidden className={`mr-2 size-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />{refreshing ? "Refreshing…" : "Refresh"}</Button>
    </div>
    <p className="text-xs text-muted">Saved for this picture across Intake, Screenplay and Assets. Generation uses this exact model; loading failures stop the run.</p>
    {error ? <p role="alert" className="text-sm text-rec">{error}</p> : null}
  </div>;
}
