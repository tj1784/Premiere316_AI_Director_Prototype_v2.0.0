import { useEffect, useState } from "react";
import { buildEngineConfigs, type EngineConfig } from "@/lib/studio/engine-config";
import { formatBytes, modalitySummary, type LogicalModel, type ModelCatalog } from "@/lib/studio/model-catalog";
import { desktopCatalog } from "@/lib/desktop/client";
import { configureEngine } from "@/lib/studio/configured-engine";
import { MODEL_ROOT } from "@/lib/studio/types";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { cn } from "@/lib/utils";

export function Bin() {
  const tab = useStudio((s) => s.binTab);
  const setBinTab = useStudio((s) => s.setBinTab);
  const picture = useActivePicture();

  return (
    <aside data-panel-kind="generation" className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex gap-1 px-2 py-2">
        {(["assets", "engines", "models"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setBinTab(t)}
            className={cn(
              "h-9 flex-1 rounded-sm text-xs capitalize",
              tab === t ? "bg-elevated text-fg" : "text-muted hover:text-fg",
            )}
          >
            {t === "assets" ? "Bin" : t === "engines" ? "Engines" : "Models"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {tab === "assets" && picture ? (
          <ul className="grid gap-1">
            {picture.shots.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => useStudio.getState().selectShot(s.id)}
                  className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-xs hover:bg-elevated"
                >
                  <span>
                    {String(s.index).padStart(2, "0")} · {s.durationSec}s
                  </span>
                  <span className="truncate text-subtle">{s.type}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {tab === "engines" ? <EngineConfigsBay /> : null}
        {tab === "models" ? <ModelsBay /> : null}
      </div>
    </aside>
  );
}

function EngineConfigsBay() {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void desktopCatalog({}).then(setCatalog);
  }, []);

  const configs = catalog ? buildEngineConfigs(catalog) : [];
  const ready = configs.filter((config) => config.status === "Ready").length;

  return (
    <div>
      <p className="text-[11px] tracking-wide text-subtle uppercase">Standalone engine configs</p>
      <p className="mt-1 text-[10px] text-subtle">
        {catalog ? `${configs.length} base checkpoints · ${ready} generation-ready` : "Reading base checkpoints…"}
      </p>
      <ul className="mt-2 grid gap-2">
        {configs.map((config) => (
          <li key={config.id}>
            <button
              type="button"
              onClick={() => setOpenId(openId === config.id ? null : config.id)}
              className="w-full rounded-sm bg-elevated px-2 py-2 text-left"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-xs" title={config.displayName}>{config.displayName}</p>
                <span className={cn("shrink-0 text-[10px]", config.status === "Ready" ? "text-accent" : "text-muted")}>
                  {config.status}
                </span>
              </div>
              <p className="truncate text-[10px] text-subtle">
                {config.family} · {config.modality} · {formatBytes(config.runtimeSizeBytes)} load
              </p>
            </button>
            {openId === config.id ? <EngineConfigExpert config={config} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EngineConfigExpert({ config }: { config: EngineConfig }) {
  const configured = configureEngine(config);
  return (
    <div className="mt-1 border-l border-border py-1 pl-2">
      <ComponentLine label="Base" components={[config.base]} />
      {config.slots.map((slot) => (
        <ComponentLine
          key={slot.role}
          label={slot.label}
          components={slot.selected}
          missing={slot.required && slot.selected.length === 0}
          alternatives={slot.alternatives}
        />
      ))}
      <div className="mt-1 border-t border-border pt-1">
        <ConfigMetric label="Installed family footprint" value={formatBytes(configured.memory.installedFamilyFootprintBytes)} />
        <ConfigMetric label="Selected configuration footprint" value={formatBytes(configured.memory.selectedConfigurationFootprintBytes)} />
        <ConfigMetric label="Estimated VRAM" value="Not reported by native adapter" />
        <ConfigMetric label="Measured peak VRAM" value="Not calibrated" />
        <ConfigMetric label="Estimated system RAM" value="Not reported by native adapter" />
        <ConfigMetric label="Measured peak system RAM" value="Not calibrated" />
      </div>
      <p className={cn("mt-1 text-[10px]", configured.validation.errors.length ? "text-rec" : "text-muted")}>{configured.validation.state}</p>
      {config.status === "Adapter unavailable" ? (
        <p className="mt-1 text-[10px] text-muted">Runtime adapter not yet implemented. This configuration remains visible and disabled.</p>
      ) : null}
      <p className="mt-1 text-[10px] text-subtle">Runtime inspect/wake is intentionally unavailable; packaged Generate performs the privileged worker check after one-use authorization.</p>
      {configured.capabilities ? (
        <>
          <p className="mt-2 text-[10px] text-subtle">Native controls · {configured.capabilities.modelVariant}</p>
          <p className="text-[10px] text-muted">
            {configured.capabilities.presets.map((preset) => preset.label).join(" · ")} · {configured.capabilities.controls.steps.runtimeDefault} steps · guidance {configured.capabilities.controls.guidance.runtimeDefault}
          </p>
          <p className="mt-2 text-[10px] text-subtle">Benchmarking is package-gate evidence only; the product UI cannot generate calibration media outside a prepared asset.</p>
        </>
      ) : null}
    </div>
  );
}

function ConfigMetric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-2 py-0.5 text-[9px]"><span className="text-muted">{label}</span><span className="text-right text-subtle">{value}</span></div>;
}

function ComponentLine({
  label,
  components,
  missing = false,
  alternatives = [],
}: {
  label: string;
  components: EngineConfig["base"][];
  missing?: boolean;
  alternatives?: EngineConfig["base"][];
}) {
  return (
    <div className="py-1">
      <p className="text-[10px] text-muted">{label}</p>
      {components.length > 0 ? components.map((component) => (
        <p key={component.path} className="truncate text-[10px] text-subtle" title={component.path}>
          {component.displayName} · {formatBytes(component.sizeBytes)}
        </p>
      )) : <p className={cn("text-[10px]", missing ? "text-rec" : "text-subtle")}>{missing ? "Missing" : "Not required"}</p>}
      {alternatives.length > 0 ? (
        <div className="mt-0.5 border-l border-border pl-1.5">
          <p className="text-[10px] text-subtle">Alternatives</p>
          {alternatives.map((component) => (
            <p key={component.path} className="truncate text-[10px] text-subtle" title={component.path}>
              {component.displayName} · {formatBytes(component.sizeBytes)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ModelsBay() {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [busy, setBusy] = useState<"scan" | "deep" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load(opts: { force?: boolean; deep?: boolean } = {}) {
    setBusy(opts.deep ? "deep" : "scan");
    try {
      const next = await desktopCatalog(opts);
      setCatalog(next);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const models = catalog?.models.filter((m) => m.independentlyUsable) ?? [];
  const unmapped = catalog?.unmapped ?? [];

  return (
    <div>
      <p className="text-[11px] text-subtle">{MODEL_ROOT}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="text-[11px] text-accent"
          disabled={busy !== null}
          onClick={() => void load({ force: true })}
        >
          {busy === "scan" ? "Scanning…" : "Rescan Models"}
        </button>
        <button
          type="button"
          className="text-[11px] text-muted"
          disabled={busy !== null}
          onClick={() => void load({ force: true, deep: true })}
        >
          {busy === "deep" ? "Verifying…" : "Deep Verify / SHA-256"}
        </button>
      </div>
      {catalog?.error ? <p className="mt-2 text-[11px] text-rec">{catalog.error}</p> : null}
      {catalog?.stats ? (
        <p className="mt-2 text-[10px] text-subtle">
          {catalog.stats.logicalModels} logical · {formatBytes(catalog.stats.totalBytes)} ·{" "}
          {(catalog.stats.scanDurationMs / 1000).toFixed(1)}s
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-subtle">Reading the bay…</p>
      )}
      <ul className="mt-2 grid gap-2">
        {models.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => setOpenId(openId === m.id ? null : m.id)}
              className="w-full rounded-sm bg-elevated px-2 py-2 text-left"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-xs">{m.displayName}</p>
                <span className={cn("shrink-0 text-[11px]", m.status === "Ready" ? "text-accent" : "text-muted")}>{m.status}</span>
              </div>
              <p className="text-[10px] text-subtle">
                {formatBytes(m.sizeBytes)} · {modalitySummary(m)}
              </p>
            </button>
            {openId === m.id ? <ModelExpert model={m} /> : null}
          </li>
        ))}
      </ul>
      {unmapped.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] tracking-wide text-subtle uppercase">Needs mapping</p>
          <ul className="mt-2 grid gap-1">
            {unmapped.slice(0, 40).map((c) => (
              <li key={c.id} className="rounded-sm px-2 py-1.5">
                <p className="truncate text-[11px]">{c.displayName}</p>
                <p className="truncate text-[10px] text-subtle">
                  {c.role} · {formatBytes(c.sizeBytes)}
                </p>
              </li>
            ))}
          </ul>
          {unmapped.length > 40 ? (
            <p className="mt-1 text-[10px] text-subtle">+{unmapped.length - 40} more unmapped components</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ModelExpert({ model }: { model: LogicalModel }) {
  const roles = ["transformer", "standalone", "text_encoder", "vae", "audio_vae", "projector", "tokenizer", "upscaler", "lora", "control", "support"] as const;
  const grouped = roles
    .map((role) => ({ role, items: model.components.filter((c) => c.role === role) }))
    .filter((g) => g.items.length > 0);
  return (
    <ul className="mt-1 grid gap-1 border-l border-border pl-2">
      {grouped.map((g) =>
        g.items.slice(0, g.role === "lora" ? 8 : 12).map((c) => (
          <li key={c.id} className="py-1">
            <p className="text-[10px] text-muted">
              {labelRole(c.role)} — {c.precision === "UNKNOWN" ? c.quantization : c.precision}
            </p>
            <p className="truncate text-[10px] text-subtle" title={c.path}>
              {formatBytes(c.sizeBytes)}
            </p>
          </li>
        )),
      )}
      {model.components.filter((c) => c.role === "lora").length > 8 ? (
        <li className="text-[10px] text-subtle">+{model.components.filter((c) => c.role === "lora").length - 8} LoRAs</li>
      ) : null}
      {model.status === "Missing dependency" ? (
        <li className="text-[10px] text-muted">Missing: {model.requiredComponents.join(", ")}</li>
      ) : null}
    </ul>
  );
}

function labelRole(role: string): string {
  if (role === "transformer" || role === "standalone") return "Transformer";
  if (role === "text_encoder") return "Text encoder";
  if (role === "vae") return "VAE";
  if (role === "audio_vae") return "Audio VAE";
  if (role === "upscaler") return "Spatial upscaler";
  if (role === "lora") return "LoRA";
  if (role === "projector") return "Projector";
  if (role === "tokenizer") return "Tokenizer";
  if (role === "control") return "Adapter";
  return "Support";
}
