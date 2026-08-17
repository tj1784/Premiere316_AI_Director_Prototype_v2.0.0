import React, { useEffect, useState } from "react";
import { useStore } from "../store";

type Props = {
  onConnectComfyUI?: () => void;
};

function comfyEndpointLabel(url?: string) {
  if (!url) return "configured address";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function ProjectGate({ onConnectComfyUI }: Props) {
  const store = useStore();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"feature" | "shorts">("shorts");

  useEffect(() => {
    store.refreshProjects();
    store.refreshHealth();
  }, []);

  const create = () => {
    if (name.trim()) store.createProject(name.trim(), category);
  };

  return (
    <div className="project-gate">
      <div className="gate-glow gate-glow-one" />
      <div className="gate-glow gate-glow-two" />
      <section className="gate-card premium-panel">
        <div className="gate-brand">
          <span className="brand-mark large">Pr</span>
          <div>
            <h1>Premiere<span>316</span></h1>
            <p>AI Director for ComfyUI</p>
          </div>
        </div>
        <p className="gate-lede">
          Build LTX video sequences visually. Select only the prompt segments you need, anchor motion with
          first, middle, and last guide frames, then stitch, score, mix, and export the final master.
        </p>

        <div className="gate-status-row">
          <span className={store.health.comfy ? "good" : "bad"}>
            <i /> {store.health.capabilities?.dedicatedComfyUI ? "Dedicated ComfyUI" : "ComfyUI"} {store.health.comfy ? `connected · ${comfyEndpointLabel(store.health.comfyUrl)}` : "offline"}
          </span>
          <span className={store.health.ffmpeg ? "good" : "bad"}>
            <i /> FFmpeg {store.health.ffmpeg ? "ready" : "not found"}
          </span>
          {onConnectComfyUI ? (
            <button className="button ghost" type="button" onClick={onConnectComfyUI}>
              {store.health.comfy ? "Change ComfyUI" : "Connect ComfyUI"}
            </button>
          ) : null}
        </div>

        <div className="new-project-box">
          <label htmlFor="project-name">Create a new project</label>
          <div className="project-category-toggle" role="group" aria-label="Project category">
            <button type="button" className={category === "feature" ? "active" : ""} onClick={() => setCategory("feature")}>
              Feature
              <small>Screenplay + approval</small>
            </button>
            <button type="button" className={category === "shorts" ? "active" : ""} onClick={() => setCategory("shorts")}>
              Shorts
              <small>9:16 · skip screenplay · no gate</small>
            </button>
          </div>
          <div className="gate-create-row">
            <input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={category === "shorts" ? "Harrowing stairs short" : "Genesis Short Film"}
              onKeyDown={(event) => {
                if (event.key === "Enter") create();
              }}
            />
            <button className="button primary large-button" disabled={!name.trim() || store.busy} onClick={create}>
              {store.busy ? "Creating…" : "Create project"}
            </button>
          </div>
        </div>

        <div className="recent-heading">
          <div>
            <span>Recent projects</span>
            <small>Open and continue editing</small>
          </div>
          <button className="button ghost" onClick={() => store.refreshProjects()}>Refresh</button>
        </div>

        <div className="recent-projects">
          {!store.projects.length && <div className="empty-recent">No projects yet. Create the first one above.</div>}
          {store.projects.map((project) => (
            <button key={project.slug} className="recent-project" onClick={() => store.openProject(project.slug)}>
              <span className="recent-icon">▶</span>
              <span className="recent-copy">
                <b>{project.name}</b>
                <small>{project.category === "shorts" ? "Shorts · " : ""}{project.clipCount} clips · {project.masterCount || 0} masters</small>
              </span>
              <span className="recent-arrow">→</span>
            </button>
          ))}
        </div>

        {store.error && <button className="gate-error" onClick={() => store.setError(null)}>{store.error}</button>}
      </section>
    </div>
  );
}
