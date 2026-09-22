import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HERMES_MODEL_ID,
  PRODUCTION_ROLE_LABELS,
  hydrateProductionRouting,
  refreshLocalBindingStatuses,
  selectProductionExecutionMode,
  selectProductionProfile,
  type ProductionExecutionMode,
  type ProductionProfileId,
  type ProductionRoutingState,
} from "@/lib/studio/production-profiles";
import { localLLMStatus } from "@/lib/studio/screenplay-client";
import { discoverAstra } from "@/lib/studio/bible-api";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PROFILE_COPY: Record<ProductionProfileId, { title: string; description: string }> = {
  "astra-ultra": {
    title: "Astra Ultra",
    description:
      "Cloud production profile. Selected by default; execution stays blocked until an Ultra-capable Astra provider is configured.",
  },
  "local-models": {
    title: "Local Models",
    description:
      "Role-routed LM Studio workflow using exact callable model IDs and fail-closed availability checks.",
  },
};

const MODE_COPY: Record<ProductionExecutionMode, { title: string; description: string }> = {
  guided: {
    title: "Guided review",
    description: "Run one bounded production unit, save its draft, and stop for your approval.",
  },
  "autonomous-complete-script": {
    title: "Autonomous complete script",
    description:
      "Explicitly start the complete text package, with persistent scene checkpoints, bounded requests and final review.",
  },
};

function persistedRouting(picture: Picture): ProductionRoutingState {
  return hydrateProductionRouting(picture.productionRouting, {
    legacyLocalSelection: Boolean(
      picture.screenplay.pinnedWriterServedId || picture.screenplay.selectedModelId,
    ),
    now: picture.updatedAt,
  });
}

export function ProductionProfileControls({
  picture,
  disabled = false,
}: {
  picture: Picture;
  disabled?: boolean;
}) {
  disabled = disabled || picture.bibleRun?.status === "running";
  const patchActive = useStudio((state) => state.patchActive);
  const routing = useMemo(
    () => persistedRouting(picture),
    [
      picture.productionRouting,
      picture.screenplay.pinnedWriterServedId,
      picture.screenplay.selectedModelId,
      picture.updatedAt,
    ],
  );
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef(0);
  const autoRefreshKey = useRef("");

  const saveRouting = useCallback(
    (next: ProductionRoutingState, patchWriter = false) => {
      const latest = useStudio.getState().pictures.find((p) => p.id === picture.id);
      if (!latest || latest.bibleRun?.status === "running") return;
      const updatedAt = Date.now();
      useStudio.getState().replaceActive({
        ...latest,
        productionRouting: { ...next, updatedAt },
        ...(patchWriter
          ? {
              screenplay: {
                ...latest.screenplay,
                selectedModelId: `lmstudio:${HERMES_MODEL_ID}`,
                pinnedWriterServedId: HERMES_MODEL_ID,
                updatedAt,
              },
            }
          : {}),
      });
    },
    [picture.id],
  );

  const refresh = useCallback(async () => {
    if (routing.profileId !== "local-models") return;
    const current = ++request.current;
    setRefreshing(true);
    try {
      const status = await localLLMStatus();
      if (current !== request.current) return;
      const latest = useStudio.getState().pictures.find((p) => p.id === picture.id);
      if (!latest || latest.productionRouting?.profileId !== routing.profileId) return;
      saveRouting(
        refreshLocalBindingStatuses(
          persistedRouting(latest),
          status.provider.models.map((model) => ({ id: model.id, loaded: model.loaded })),
          status.provider.available,
          status.provider.reason,
        ),
      );
    } catch (error) {
      if (current !== request.current) return;
      const latest = useStudio.getState().pictures.find((p) => p.id === picture.id);
      if (latest?.productionRouting?.profileId === routing.profileId)
        saveRouting(
          refreshLocalBindingStatuses(
            persistedRouting(latest),
            [],
            false,
            error instanceof Error ? error.message : "LM Studio is unavailable.",
          ),
        );
    } finally {
      if (current === request.current) setRefreshing(false);
    }
  }, [routing, saveRouting, picture.id]);

  useEffect(() => {
    const key = `${picture.id}:${routing.profileId}`;
    if (
      routing.profileId === "local-models" &&
      autoRefreshKey.current !== key &&
      routing.bindings.some((binding) => binding.status === "needs-refresh")
    ) {
      autoRefreshKey.current = key;
      void refresh();
    }
  }, [picture.id, refresh, routing.bindings, routing.profileId]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  return (
    <section
      className="grid gap-4 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
      aria-labelledby="production-profile-heading"
    >
      <div>
        <h2 id="production-profile-heading" className="text-base font-semibold text-fg">
          Production profile
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Profile chooses the model crew. Run mode independently chooses where the workflow pauses.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Production profile">
        {(Object.keys(PROFILE_COPY) as ProductionProfileId[]).map((profileId) => {
          const selected = routing.profileId === profileId;
          const copy = PROFILE_COPY[profileId];
          return (
            <button
              key={profileId}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              data-production-profile={profileId}
              className={cn(
                "min-h-24 rounded-md border p-3 text-left transition-colors",
                selected ? "border-accent bg-inset" : "border-edge bg-surface hover:bg-inset",
                disabled && "cursor-not-allowed opacity-60",
              )}
              onClick={() =>
                saveRouting(
                  selectProductionProfile(routing, profileId),
                  profileId === "local-models",
                )
              }
            >
              <span className="flex items-center justify-between gap-3 text-sm font-medium text-fg">
                {copy.title}
                {selected ? <Check className="size-4 text-accent" aria-hidden /> : null}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted">
                {copy.description}
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-fg">Run mode</p>
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label="Production run mode"
        >
          {(Object.keys(MODE_COPY) as ProductionExecutionMode[]).map((mode) => {
            const selected = routing.executionMode === mode;
            const copy = MODE_COPY[mode];
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                data-production-mode={mode}
                className={cn(
                  "min-h-20 rounded-md border p-3 text-left transition-colors",
                  selected ? "border-accent bg-inset" : "border-edge bg-surface hover:bg-inset",
                  disabled && "cursor-not-allowed opacity-60",
                )}
                onClick={() => saveRouting(selectProductionExecutionMode(routing, mode))}
              >
                <span className="text-sm font-medium text-fg">{copy.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">
                  {copy.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {routing.profileId === "local-models" ? (
        <details className="rounded-md border border-edge bg-surface p-3" open>
          <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-fg">
            Exact local role map
          </summary>
          <div className="mt-2 grid gap-2">
            {routing.bindings.map((binding) => (
              <div
                key={binding.role}
                className="grid gap-1 rounded-md bg-inset p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-3"
                data-production-role={binding.role}
              >
                <div className="min-w-0">
                  <p className="font-medium text-fg">{PRODUCTION_ROLE_LABELS[binding.role]}</p>
                  <p className="mt-1 break-words text-muted">
                    {binding.label}
                    {binding.optional ? " · optional" : ""}
                  </p>
                  {binding.role === "prompt-cue" ? (
                    <p className="mt-1 break-all text-muted">
                      Artifact: {binding.artifactFileName}
                    </p>
                  ) : null}
                  <p className="mt-1 break-all text-muted">
                    Callable ID: {binding.callableModelId}
                  </p>
                </div>
                <span
                  className={cn(
                    "w-fit rounded-full px-2 py-1 font-medium",
                    binding.status === "loaded"
                      ? "bg-ok/15 text-ok"
                      : binding.status === "installed"
                        ? "bg-accent/15 text-accent"
                        : "bg-rec/15 text-rec",
                  )}
                  title={binding.statusReason}
                >
                  {binding.status === "needs-refresh"
                    ? "Checking"
                    : binding.status.replace("-", " ")}
                </span>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <p className="min-w-0 flex-1 text-xs text-muted">
                <ShieldAlert className="mr-1 inline size-3.5" aria-hidden />
                GAIN keeps LM Studio’s real MTP-ending callable alias, while artifact verification
                requires the regular Q8_0 file.
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="min-h-11"
                disabled={disabled || refreshing}
                onClick={() => void refresh()}
              >
                <RefreshCw
                  className={cn(
                    "mr-2 size-4",
                    refreshing && "animate-spin motion-reduce:animate-none",
                  )}
                  aria-hidden
                />
                {refreshing ? "Checking…" : "Refresh models"}
              </Button>
            </div>
          </div>
        </details>
      ) : (
        <div className="grid gap-2 rounded-md border border-border bg-surface p-3 text-xs leading-relaxed">
          <p>{routing.bindings[0]?.statusReason}</p>
          <p className="break-all">
            Resolved model: {routing.bindings[0]?.callableModelId ?? "Not configured"} · required
            effort: Ultra
          </p>
          <Button
            variant="secondary"
            disabled={disabled || refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                const info = await discoverAstra();
                const latest = useStudio.getState().pictures.find((p) => p.id === picture.id);
                if (
                  !latest ||
                  latest.productionRouting?.profileId !== "astra-ultra" ||
                  latest.bibleRun?.status === "running"
                )
                  return;
                useStudio.getState().replaceActive({
                  ...latest,
                  productionRouting: {
                    ...persistedRouting(latest),
                    bindings: persistedRouting(latest).bindings.map((b) => ({
                      ...b,
                      callableModelId: info.available ? info.modelId : null,
                      status: info.available ? "installed" : "unavailable",
                      statusReason: `${info.provider ? `${info.provider}: ` : ""}${info.reason}`,
                    })),
                  },
                });
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
              } finally {
                setRefreshing(false);
              }
            }}
          >
            Discover configured Astra provider
          </Button>
        </div>
      )}
    </section>
  );
}
