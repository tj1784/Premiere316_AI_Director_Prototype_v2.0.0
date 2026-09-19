import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CHANNEL_REGIONS,
  FRAMING_LABELS,
  REGION_LABELS,
  REGULATION_LABELS,
} from "@/lib/emotion/constants";
import { resolveLineSettings } from "@/lib/emotion/compiler";
import { performanceFraming } from "@/lib/emotion/integration";
import type { Catalog, PerformanceSettings, SceneConfig, Selection } from "@/lib/emotion/types";
import type { Picture } from "@/lib/studio/types";

const inputClass = "min-h-11 w-full rounded border border-border bg-inset px-3 py-2 text-sm";
export function CueboardSettingsEditor({
  config,
  catalog,
  picture,
  sceneId,
  onChange,
}: {
  config: SceneConfig;
  catalog: Catalog;
  picture: Picture;
  sceneId: string;
  onChange: (next: SceneConfig) => void;
}) {
  const [lineId, setLineId] = useState(config.lines[0]?.line_id ?? "");
  const [scope, setScope] = useState("line");
  const line = config.lines.find((l) => l.line_id === lineId) ?? config.lines[0];
  if (!line) return <p>No approved dialogue or assigned silent reactions in this scene.</p>;
  const framing = performanceFraming(picture, sceneId, line.line_id);
  const { settings: resolved, trace } = resolveLineSettings(config, line, framing.framing);
  const settings =
    scope === "scene"
      ? config.scene_defaults
      : scope === "character"
        ? (config.character_overrides[line.character_id] ?? {})
        : line.overrides;
  function patch(key: keyof PerformanceSettings, value: unknown) {
    const next = structuredClone(config);
    const target =
      scope === "scene"
        ? next.scene_defaults
        : scope === "character"
          ? (next.character_overrides[line.character_id] ??= {})
          : next.lines.find((l) => l.line_id === line.line_id)!.overrides;
    if (value === undefined) delete target[key];
    else Object.assign(target, { [key]: value });
    onChange(next);
  }
  const selectEmotion = (
    selection: Selection | undefined,
    update: (value: Selection) => void,
    label: string,
  ) => {
    const emotion = catalog.emotions.find((e) => e.id === selection?.emotion_id);
    return (
      <fieldset className="grid gap-2 rounded border border-border p-3 sm:grid-cols-3">
        <legend className="px-1 text-xs">{label}</legend>
        <label className="text-xs">
          Family / subfamily / state
          <select
            aria-label={`${label} state`}
            className={inputClass}
            value={emotion?.id ?? ""}
            onChange={(e) => {
              const record = catalog.emotions.find((v) => v.id === e.target.value)!;
              update({
                emotion_id: record.id,
                variant_id: record.variants[0].id,
                intensity: selection?.intensity ?? 3,
              });
            }}
          >
            <option value="" disabled>
              Choose an authored state
            </option>
            {catalog.emotions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.family_label} / {e.subfamily_label} / {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Variant
          <select
            aria-label={`${label} variant`}
            className={inputClass}
            disabled={!emotion}
            value={selection?.variant_id ?? ""}
            onChange={(e) => update({ ...selection!, variant_id: e.target.value })}
          >
            {!emotion && <option value="">Choose a state first</option>}
            {emotion?.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Felt / displayed intensity
          <select
            aria-label={`${label} intensity`}
            className={inputClass}
            disabled={!selection}
            value={selection?.intensity ?? 3}
            onChange={(e) =>
              update({ ...selection!, intensity: Number(e.target.value) as Selection["intensity"] })
            }
          >
            {catalog.intensity_labels.map((label, i) => (
              <option key={label} value={i + 1}>
                {i + 1} · {label}
              </option>
            ))}
          </select>
        </label>
        {emotion && (
          <p className="text-xs text-muted sm:col-span-3">
            {emotion.definition}{" "}
            {emotion.levels.find((l) => l.level === selection?.intensity)?.felt_state}
          </p>
        )}
      </fieldset>
    );
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          Approved line or silent reaction
          <select
            aria-label="Cueboard line"
            className={inputClass}
            value={line.line_id}
            onChange={(e) => setLineId(e.target.value)}
          >
            {config.lines.map((l, i) => (
              <option key={l.line_id} value={l.line_id}>
                {i + 1}. {config.character_baselines[l.character_id].label}:{" "}
                {l.spoken_text || "Silent reaction"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Editing scope
          <select className={inputClass} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="line">This line</option>
            <option value="character">Character in this scene</option>
            <option value="scene">Scene defaults</option>
          </select>
        </label>
      </div>
      <blockquote className="whitespace-pre-wrap border-l-2 border-border pl-3 text-sm">
        {line.spoken_text || "Silent reaction · no speech"}
      </blockquote>
      <p className="text-xs text-muted">
        {framing.source}. Effective framing: {FRAMING_LABELS[resolved.framing]} ({trace.framing}).
        Dialogue, speaker identity and production sound permissions are locked.
      </p>
      {(settings.felt_layers ?? resolved.felt_layers).map((layer, index, layers) => (
        <div key={index}>
          {selectEmotion(
            layer.selection,
            (selection) =>
              patch(
                "felt_layers",
                layers.map((v, i) => (i === index ? { ...v, selection } : v)),
              ),
            layer.role === "dominant" ? "Dominant feeling" : `Secondary feeling ${index}`,
          )}
          {layer.role === "secondary" && (
            <div className="flex gap-2">
              <label className="text-xs">
                Layer weight
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={layer.layer_weight}
                  onChange={(e) =>
                    patch(
                      "felt_layers",
                      layers.map((v, i) =>
                        i === index ? { ...v, layer_weight: Number(e.target.value) } : v,
                      ),
                    )
                  }
                />
              </label>
              <Button
                variant="ghost"
                onClick={() =>
                  patch(
                    "felt_layers",
                    layers.filter((_, i) => i !== index),
                  )
                }
              >
                Remove layer
              </Button>
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            const layers = settings.felt_layers ?? resolved.felt_layers;
            const emotion = catalog.emotions.find(
              (e) => !layers.some((l) => l.selection.emotion_id === e.id),
            );
            if (emotion)
              patch("felt_layers", [
                ...layers,
                {
                  role: layers.length ? "secondary" : "dominant",
                  layer_weight: 1,
                  selection: {
                    emotion_id: emotion.id,
                    variant_id: emotion.variants[0].id,
                    intensity: 3,
                  },
                },
              ]);
          }}
        >
          {resolved.felt_layers.length ? "Add felt layer" : "Add dominant feeling"}
        </Button>
        <Button variant="ghost" onClick={() => patch("felt_layers", undefined)}>
          Inherit felt layers
        </Button>
      </div>
      {selectEmotion(
        resolved.displayed_selection ?? undefined,
        (value) => patch("displayed_selection", value),
        "Displayed feeling",
      )}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => patch("displayed_selection", undefined)}>
          Inherit displayed feeling
        </Button>
        <Button variant="ghost" onClick={() => patch("displayed_selection", null)}>
          Use felt display
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          Regulation · {trace.regulation}
          <select
            className={inputClass}
            value={settings.regulation ?? ""}
            onChange={(e) => patch("regulation", e.target.value || undefined)}
          >
            <option value="">Inherit ({resolved.regulation})</option>
            {Object.entries(REGULATION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Framing override
          <select
            className={inputClass}
            value={settings.framing ?? ""}
            onChange={(e) => patch("framing", e.target.value || undefined)}
          >
            <option value="">Inherit ({FRAMING_LABELS[resolved.framing]})</option>
            {Object.entries(FRAMING_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {(["display_allowance", "arousal_override"] as const).map((key) => (
          <label key={key} className="text-xs">
            {key === "display_allowance" ? "Display allowance" : "Arousal"} · 0–1 · {trace[key]}
            <input
              className={inputClass}
              type="number"
              min={0}
              max={1}
              step={0.05}
              placeholder={`Inherit (${resolved[key] ?? "unset"})`}
              value={settings[key] ?? ""}
              onChange={(e) =>
                patch(key, e.target.value === "" ? undefined : Number(e.target.value))
              }
            />
          </label>
        ))}
        {(["objective", "appraisal", "relationship_context", "physical_context"] as const).map(
          (key) => (
            <label key={key} className="text-xs">
              {key.replace(/_/g, " ")} · {trace[key]}
              <textarea
                className={inputClass}
                placeholder={
                  resolved[key] || "Inherit; not applicable may be stated with a role reason"
                }
                value={settings[key] ?? ""}
                onChange={(e) => patch(key, e.target.value || undefined)}
              />
            </label>
          ),
        )}
      </div>
      <p className="text-xs text-muted">
        Intensity does not set volume. Use Voice → Loudness to author quiet delivery, including
        level seven. Contact directions must name participants, support/weight and the settled
        endpoint.
      </p>
      {(Object.keys(CHANNEL_REGIONS) as Array<keyof typeof CHANNEL_REGIONS>).map((channel) => {
        const key = `${channel}_overrides` as
          "face_overrides" | "voice_overrides" | "body_overrides";
        return (
          <details key={channel} className="rounded border border-border p-3">
            <summary className="min-h-11 cursor-pointer text-sm capitalize">
              {channel} · {CHANNEL_REGIONS[channel].length} regions
            </summary>
            <div className="grid gap-3 sm:grid-cols-2">
              {CHANNEL_REGIONS[channel].map((region) => (
                <label key={region} className="text-xs">
                  {REGION_LABELS[region]} · {trace[`${key}.${region}`] ?? "catalog"} · effective{" "}
                  {resolved[key]?.[region]?.mode ?? "catalog"}
                  <select
                    className={inputClass}
                    value={settings[key]?.[region]?.mode ?? "inherit"}
                    disabled={region === "nonverbal_vocalizations"}
                    onChange={(e) => {
                      const controls = { ...settings[key] };
                      if (e.target.value === "inherit") delete controls[region];
                      else
                        controls[region] = {
                          mode: e.target.value as "omit" | "replace",
                          ...(e.target.value === "replace" ? { instruction: "" } : {}),
                        };
                      patch(key, Object.keys(controls).length ? controls : undefined);
                    }}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="omit">Omit</option>
                    <option value="replace">Replace</option>
                  </select>
                  {settings[key]?.[region]?.mode === "replace" && (
                    <input
                      aria-label={`${REGION_LABELS[region]} instruction`}
                      className={inputClass}
                      value={settings[key]?.[region]?.instruction ?? ""}
                      onChange={(e) =>
                        patch(key, {
                          ...settings[key],
                          [region]: { mode: "replace", instruction: e.target.value },
                        })
                      }
                    />
                  )}
                </label>
              ))}
            </div>
          </details>
        );
      })}
      <label className="block text-xs">
        Explicit cue IDs (optional, comma separated)
        <input
          className={inputClass}
          value={settings.explicit_cue_ids?.join(", ") ?? ""}
          onChange={(e) =>
            patch(
              "explicit_cue_ids",
              e.target.value
                ? e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                : undefined,
            )
          }
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          Continue from line
          <select
            className={inputClass}
            value={settings.continuity?.from_line_id ?? ""}
            onChange={(e) =>
              patch("continuity", { ...resolved.continuity, from_line_id: e.target.value || null })
            }
          >
            <option value="">No explicit predecessor</option>
            {config.lines
              .filter((l) => l.line_id !== line.line_id)
              .map((l, i) => (
                <option key={l.line_id} value={l.line_id}>
                  {i + 1}. {config.character_baselines[l.character_id].label}:{" "}
                  {l.spoken_text || "Silent reaction"}
                </option>
              ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.continuity?.restart_onset ?? resolved.continuity.restart_onset}
            onChange={(e) =>
              patch("continuity", { ...resolved.continuity, restart_onset: e.target.checked })
            }
          />
          Intentionally restart onset
        </label>
      </div>
      <p className="text-xs text-muted">
        Timed beat overrides and exact timing remain available in Expert JSON. Saving validates all
        scopes before creating a new version.
      </p>
    </div>
  );
}
