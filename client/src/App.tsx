import React, { useEffect, useState } from "react";
import { useStore } from "./store";
import ProjectGate from "./components/ProjectGate";
import CreativeWorkspace from "./components/CreativeWorkspace";
import ScreenplayWorkspace from "./components/ScreenplayWorkspace";
import AssetsWorkspace from "./components/AssetsWorkspace";

function portLabel(url: string | undefined, fallback: number) {
  if (!url) return `:${fallback}`;
  try {
    const parsed = new URL(url);
    return parsed.port ? `:${parsed.port}` : `:${fallback}`;
  } catch {
    return `:${fallback}`;
  }
}

export default function App() {
  const store = useStore();
  const [workspace, setWorkspace] = useState<"edit" | "screenplay" | "assets">("edit");

  useEffect(() => {
    store.refreshHealth();
    store.refreshProjects();
    store.refreshQueue();
    const requestedProject = new URLSearchParams(window.location.search).get("project");
    if (requestedProject) store.openProject(requestedProject);
    const healthTimer = window.setInterval(store.refreshHealth, 10000);
    const queueTimer = window.setInterval(store.refreshQueue, 1600);
    return () => {
      window.clearInterval(healthTimer);
      window.clearInterval(queueTimer);
    };
  }, []);

  if (!store.project) return <ProjectGate />;

  const projectJobs = store.jobs.filter((job) => job.projectSlug === store.project.slug);
  const running = projectJobs.filter((job) => job.status === "running" || job.status === "queued").length;

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand-button" onClick={() => store.closeProject()} title="Back to projects">
          <span className="brand-mark">Pr</span>
          <span className="brand-copy">
            <strong>Premiere<span>316</span></strong>
            <small>AI Director</small>
          </span>
        </button>

        <button className="project-switcher" onClick={() => store.closeProject()}>
          <span className="muted">Project:</span>
          <b>{store.project.name}</b>
          <span className="chevron">⌄</span>
        </button>

        <nav className="primary-nav" aria-label="Workspace navigation">
          <button className={workspace === "screenplay" ? "active" : ""} onClick={() => setWorkspace("screenplay")}>Screenplay</button>
          <button className={workspace === "assets" ? "active" : ""} onClick={() => setWorkspace("assets")}>Assets</button>
          <button onClick={() => { setWorkspace("edit"); store.setWorkbench("guide"); }}>Media</button>
          <button className={workspace === "edit" ? "active" : ""} onClick={() => { setWorkspace("edit"); store.setWorkbench("prompt"); }}>Edit</button>
          <button onClick={() => { setWorkspace("edit"); store.setWorkbench("guide"); }}>Generate</button>
          <button onClick={() => { setWorkspace("edit"); store.setWorkbench("master"); }}>Master</button>
          <button onClick={() => { setWorkspace("edit"); store.setWorkbench("master"); }}>Export</button>
        </nav>

        <div className="header-actions">
          <span className={`connection-pill ${store.health.comfy ? "online" : "offline"}`}>
            <span className="connection-dot" />
            {store.health.comfy
              ? store.health.capabilities?.dedicatedComfyUI
                ? "Dedicated ComfyUI Connected · 8190"
                : "ComfyUI Connected"
              : `ComfyUI Offline ${portLabel(store.health.comfyUrl, 8190)}`}
          </span>
          {workspace === "screenplay" ? (
            <span className={`connection-pill ${store.health.screenplayModelAvailable ? "online" : "offline"}`} title={store.health.screenplayModel}>
              <span className="connection-dot" />
              {store.health.screenplayModelAvailable ? "LM Studio · Qwen 40B" : "LM Studio model offline"}
            </span>
          ) : null}
          <button className="icon-button" title="Save project" onClick={() => store.saveProject()}>⌘S</button>
          <button className="icon-button" title="Render queue">◫{running ? <em>{running}</em> : null}</button>
          <button className="icon-button" title="Settings">⚙</button>
          <span className="avatar">TJ</span>
        </div>
      </header>

      {store.error && (
        <button className="error-banner" onClick={() => store.setError(null)}>
          <span>!</span>
          <b>{store.error}</b>
          <small>Click to dismiss</small>
        </button>
      )}

      {workspace === "screenplay"
        ? <ScreenplayWorkspace onOpenEditor={() => setWorkspace("edit")} onOpenAssets={() => setWorkspace("assets")} />
        : workspace === "assets"
          ? <AssetsWorkspace onOpenEditor={() => setWorkspace("edit")} />
          : <CreativeWorkspace onOpenAssets={() => setWorkspace("assets")} />}
    </div>
  );
}
