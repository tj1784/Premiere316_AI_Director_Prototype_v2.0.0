import React, { useEffect, useState } from "react";
import { useStore } from "./store";
import ProjectGate from "./components/ProjectGate";
import CreativeWorkspace from "./components/CreativeWorkspace";
import ScreenplayWorkspace from "./components/ScreenplayWorkspace";
import AssetsWorkspace from "./components/AssetsWorkspace";
import StoryboardWorkspace from "./components/StoryboardWorkspace";
import PiExpertDock from "./components/PiExpertDock";
import ComfyConnectionDialog from "./components/ComfyConnectionDialog";

type ActivePage = "project-gate" | "screenplay" | "storyboard" | "assets" | "media" | "edit" | "generate" | "master" | "export";

function endpointLabel(url: string | undefined, fallback: number) {
  if (!url) return `127.0.0.1:${fallback}`;
  try {
    const parsed = new URL(url);
    return parsed.host || `127.0.0.1:${fallback}`;
  } catch {
    return url;
  }
}

export default function App() {
  const store = useStore();
  const [activePage, setActivePage] = useState<ActivePage>("edit");
  const [piOpen, setPiOpen] = useState(false);
  const [comfyDialogOpen, setComfyDialogOpen] = useState(false);

  useEffect(() => {
    store.refreshHealth();
    store.refreshProjects();
    store.refreshQueue();
    store.refreshH3Diagnostics();
    const requestedProject = new URLSearchParams(window.location.search).get("project");
    if (requestedProject) store.openProject(requestedProject);
    const healthTimer = window.setInterval(store.refreshHealth, 10000);
    const queueTimer = window.setInterval(store.refreshQueue, 1600);
    const h3Timer = window.setInterval(store.refreshH3Diagnostics, 15000);
    return () => {
      window.clearInterval(healthTimer);
      window.clearInterval(queueTimer);
      window.clearInterval(h3Timer);
    };
  }, []);

  const openComfyDialog = () => {
    store.setError(null);
    setComfyDialogOpen(true);
  };
  const connectComfyUI = async (comfyUrl: string) => {
    const connected = await store.configureComfyUI(comfyUrl);
    if (connected) setComfyDialogOpen(false);
    return connected;
  };
  const startCurrentComfyUI = async () => {
    await store.restartComfyUI();
    const connected = Boolean(useStore.getState().health.comfy);
    if (connected) setComfyDialogOpen(false);
    return connected;
  };
  const comfyDialog = (
    <ComfyConnectionDialog
      open={comfyDialogOpen}
      initialUrl={store.health.comfyUrl}
      busy={store.comfyConnectBusy || store.comfyRestartBusy || store.premiereRestartBusy}
      startingCurrent={store.comfyRestartBusy || store.health.comfyRestarting}
      error={store.error}
      onClose={() => setComfyDialogOpen(false)}
      onConnect={connectComfyUI}
      onStartCurrent={!store.health.comfy && store.health.capabilities?.dedicatedComfyRestart
        ? startCurrentComfyUI
        : undefined}
    />
  );

  if (!store.project) return <><ProjectGate onConnectComfyUI={openComfyDialog} /><PiExpertDock activePage="project-gate" open={piOpen} onOpenChange={setPiOpen} />{comfyDialog}</>;

  const isShorts = store.project.category === "shorts" || store.project.settings?.skipScreenplay === true;
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
          {isShorts ? <span className="muted"> · shorts</span> : null}
          <span className="chevron">⌄</span>
        </button>

        <nav className="primary-nav" aria-label="Workspace navigation">
          {isShorts ? null : <button className={activePage === "screenplay" ? "active" : ""} onClick={() => setActivePage("screenplay")}>Screenplay</button>}
          <button className={activePage === "storyboard" ? "active" : ""} onClick={() => setActivePage("storyboard")}>Storyboard</button>
          <button className={activePage === "assets" ? "active" : ""} onClick={() => setActivePage("assets")}>Assets</button>
          <button className={activePage === "media" ? "active" : ""} onClick={() => { setActivePage("media"); store.setWorkbench("guide"); }}>Media</button>
          <button className={activePage === "edit" ? "active" : ""} onClick={() => { setActivePage("edit"); store.setWorkbench("prompt"); }}>Edit</button>
          <button className={activePage === "generate" ? "active" : ""} onClick={() => { setActivePage("generate"); store.setWorkbench("guide"); }}>Generate</button>
          <button className={activePage === "master" ? "active" : ""} onClick={() => { setActivePage("master"); store.setWorkbench("master"); }}>Master</button>
          <button className={activePage === "export" ? "active" : ""} onClick={() => { setActivePage("export"); store.setWorkbench("master"); }}>Export</button>
        </nav>

        <div className="header-actions">
          <button
            className="premiere-restart-button"
            disabled={store.premiereRestartBusy || !store.health.capabilities?.premiereRestart}
            title="Restart the Premiere316 app server on port 8789, reconnect, and reload this page."
            onClick={() => {
              if (window.confirm("Restart Premiere316 now? The app will reconnect and reload automatically.")) {
                void store.restartPremiere316();
              }
            }}
          >
            {store.premiereRestartBusy ? "RESTARTING APP…" : "↻ RESTART PREMIERE316"}
          </button>
          <span
            className={`connection-pill ${store.health.comfy ? "online" : "offline"}`}
            title={store.health.comfyUrl || "http://127.0.0.1:8188"}
          >
            <span className="connection-dot" />
            {store.health.comfy
              ? `ComfyUI Connected ${endpointLabel(store.health.comfyUrl, 8188)}`
              : `ComfyUI Offline ${endpointLabel(store.health.comfyUrl, 8188)}`}
          </span>
          <button
            className="pi-header-button"
            disabled={store.comfyConnectBusy || store.comfyRestartBusy || store.health.comfyRestarting || running > 0 || (store.health.comfy && !store.health.capabilities?.dedicatedComfyRestart)}
            title={running
              ? "Finish or stop active generation jobs before changing or restarting ComfyUI."
              : !store.health.comfy
                ? "Enter the IP address and port of the ComfyUI Premiere316 should use."
                : store.health.capabilities?.dedicatedComfyRestart
                  ? `Safely restart Premiere316's routed ComfyUI ${endpointLabel(store.health.comfyUrl, 8188)}.`
                  : "This connected ComfyUI can be changed in Settings, but it cannot be restarted from Premiere316."}
            onClick={() => {
              if (!store.health.comfy) {
                openComfyDialog();
                return;
              }
              if (window.confirm(`Restart ComfyUI ${endpointLabel(store.health.comfyUrl, 8188)} now? The generation queue must be idle.`)) {
                void store.restartComfyUI();
              }
            }}
          >
            {store.comfyConnectBusy
              ? "CONNECTING…"
              : store.comfyRestartBusy || store.health.comfyRestarting
                ? "RESTARTING…"
                : store.health.comfy
                  ? "↻ RESTART COMFYUI"
                  : "+ CONNECT COMFYUI"}
          </button>
          {activePage === "screenplay" ? (
            <span className={`connection-pill ${store.health.screenplayModelAvailable ? "online" : "offline"}`} title={store.health.screenplayModel}>
              <span className="connection-dot" />
              {store.health.screenplayModelAvailable ? "LM Studio · Qwen 40B" : "LM Studio model offline"}
            </span>
          ) : null}
          <button className="icon-button" title="Save project" onClick={() => store.saveProject()}>⌘S</button>
          <button className="icon-button" title="Render queue">◫{running ? <em>{running}</em> : null}</button>
          <button className={`pi-header-button ${piOpen ? "active" : ""}`} title="Open Pi ComfyUI Expert" onClick={() => setPiOpen((value) => !value)}><span>π</span> Pi Expert</button>
          <button className="icon-button" title="ComfyUI connection settings" onClick={openComfyDialog}>⚙</button>
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

      {activePage === "screenplay" && !isShorts
        ? <ScreenplayWorkspace onOpenEditor={() => setActivePage("edit")} onOpenAssets={() => setActivePage("assets")} />
        : activePage === "storyboard"
          ? <StoryboardWorkspace onOpenAssets={() => setActivePage("assets")} />
        : activePage === "assets"
          ? <AssetsWorkspace onOpenEditor={() => setActivePage("edit")} />
          : <CreativeWorkspace onOpenAssets={() => setActivePage("assets")} />}
      <PiExpertDock activePage={activePage} open={piOpen} onOpenChange={setPiOpen} />
      {comfyDialog}
    </div>
  );
}
