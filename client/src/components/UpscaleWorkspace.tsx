import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { buildUpscaleManifest } from "../upscale-manifest.js";
import "./UpscaleWorkspace.css";

const PRESETS = [
  {
    label: "Old 480p restore",
    directive: "Take this blurry old 480p movie clip, clean up the heavy compression blockiness, blow it up to 4K, and make the character faces look incredibly sharp and real."
  },
  {
    label: "Gameplay 60fps",
    directive: "Convert this 1080p gameplay footage to a smooth 60fps and sharpen up the text overlays quickly without changing the art style."
  },
  {
    label: "Clean master",
    directive: "Denoise the low-light grain, correct the washed out contrast, and upscale the final master 2x without hallucinating new details."
  }
];

function storageKey(slug: string | undefined) {
  return `premiere316.upscale.directive.${slug || "project"}`;
}

function readStoredDirective(slug: string | undefined) {
  try { return localStorage.getItem(storageKey(slug)) || PRESETS[0].directive; }
  catch { return PRESETS[0].directive; }
}

function downloadJson(filename: string, json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default function UpscaleWorkspace() {
  const project = useStore((state) => state.project);
  const slug = String(project?.slug || "project");
  const jobs = useStore((state) => state.jobs);
  const health = useStore((state) => state.health);
  const [directive, setDirective] = useState(() => readStoredDirective(slug));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(storageKey(slug), directive); } catch {}
  }, [slug, directive]);

  const manifest = useMemo(() => buildUpscaleManifest(directive), [directive]);
  const manifestJson = useMemo(() => JSON.stringify(manifest, null, 2), [manifest]);
  const activeJobs = jobs.filter((job: any) => ["queued", "running", "cancelling"].includes(String(job.status || "")));
  const engine = manifest.pipeline_routing.primary_engine;
  const motion = manifest.pipeline_routing.motion_engine;
  const filters = manifest.pipeline_routing.preprocess_filters;
  const queueCount = Number(health?.comfyQueue?.running || 0) + Number(health?.comfyQueue?.pending || 0);

  const copyManifest = async () => {
    await copyText(manifestJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <main className="upscale-workspace">
      <header className="workspace-command-bar upscale-command-bar">
        <div>
          <span className="workspace-eyebrow">{"ENHANCE -> MANIFEST"}</span>
          <h1>Upscale</h1>
        </div>
        <div className="workspace-command-actions">
          <span className={`status-chip ${health?.comfy ? "approved" : "draft"}`}>{health?.comfy ? "ComfyUI ready" : "ComfyUI offline"}</span>
          <span className="status-chip draft">{activeJobs.length + queueCount} active</span>
          <button className="button secondary" type="button" onClick={() => downloadJson(`${slug}-upscale-manifest.json`, manifestJson)}>Download JSON</button>
          <button className="button primary" type="button" onClick={() => void copyManifest()}>{copied ? "Copied" : "Copy JSON"}</button>
        </div>
      </header>

      <div className="upscale-grid">
        <section className="upscale-panel upscale-source-panel">
          <header><b>Directive</b><small>{slug}</small></header>
          <div className="upscale-panel-scroll">
            <label>Enhancement request
              <textarea
                rows={10}
                spellCheck={false}
                value={directive}
                onChange={(event) => setDirective(event.target.value)}
              />
            </label>
            <div className="upscale-presets" aria-label="Upscale presets">
              {PRESETS.map((preset) => (
                <button key={preset.label} type="button" onClick={() => setDirective(preset.directive)}>{preset.label}</button>
              ))}
            </div>
            <section className="upscale-routing-stack">
              <article><span>Primary</span><b>{engine}</b></article>
              <article><span>Motion</span><b>{motion}</b></article>
              <article><span>Safety</span><b>{manifest.director_metadata.hardware_safety_tier}</b></article>
              <article><span>Filters</span><b>{filters.length ? filters.join(" + ") : "None"}</b></article>
            </section>
          </div>
        </section>

        <section className="upscale-panel upscale-parameters-panel">
          <header><b>Parameters</b><small>Validated values</small></header>
          <div className="upscale-panel-scroll">
            <div className="upscale-meter-list">
              <article>
                <header><span>Upscale</span><b>{manifest.parameters.upscale_factor.toFixed(1)}x</b></header>
                <meter min="1" max="4" value={manifest.parameters.upscale_factor} />
              </article>
              <article>
                <header><span>Denoise</span><b>{manifest.parameters.denoise_strength.toFixed(2)}</b></header>
                <meter min="0" max="1" value={manifest.parameters.denoise_strength} />
              </article>
              <article>
                <header><span>Fidelity</span><b>{manifest.parameters.generative_fidelity.toFixed(2)}</b></header>
                <meter min="0" max="1" value={manifest.parameters.generative_fidelity} />
              </article>
              <article>
                <header><span>Target FPS</span><b>{manifest.parameters.target_fps || "None"}</b></header>
                <meter min="0" max="120" value={manifest.parameters.target_fps || 0} />
              </article>
            </div>
            <div className="upscale-intent-card">
              <span>Intent</span>
              <p>{manifest.director_metadata.scene_intent_analysis}</p>
            </div>
          </div>
        </section>

        <section className="upscale-panel upscale-json-panel">
          <header><b>Manifest</b><small>Strict JSON</small></header>
          <pre>{manifestJson}</pre>
        </section>
      </div>
    </main>
  );
}
