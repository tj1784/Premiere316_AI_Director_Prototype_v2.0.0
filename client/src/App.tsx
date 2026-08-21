import React, { useCallback, useEffect, useState } from "react";
import { useStore } from "./store";
import ProjectGate from "./components/ProjectGate";
import CreativeWorkspace from "./components/CreativeWorkspace";
import ScreenplayWorkspace from "./components/ScreenplayWorkspace";
import StoryboardWorkspace from "./components/StoryboardWorkspace";
import AssetsWorkspaceOutlet from "./components/AssetsWorkspaces";
import DirectWorkspace from "./components/DirectWorkspace";
import CreateSoundWorkspace from "./components/CreateSoundWorkspace";
import ProjectContextStrip from "./components/ProjectContextStrip";
import GlobalQueueDrawer from "./components/GlobalQueueDrawer";
import PiExpertDock from "./components/PiExpertDock";
import ComfyConnectionDialog from "./components/ComfyConnectionDialog";
import { resolveProductionRoute, routeForShorts, routeSection, routeSubtab } from "./navigation";
import { comfyControlLabel, comfyControlTitle } from "./comfy-control";

const ASSET_NAV = [
  ["prompts", "Prompt Development"],
  ["generate", "Asset Generation"],
  ["characters", "Characters"],
  ["ost", "OST"],
  ["library", "Asset Library"]
];
const DIRECT_NAV = [
  ["sequence", "Sequence Director"],
  ["ltx", "LTX Director"],
  ["comfyui", "ComfyUI"]
];

function endpointLabel(url: string | undefined, fallback: number) {
  if (!url) return `127.0.0.1:${fallback}`;
  try {
    const parsed = new URL(url);
    return parsed.host || `127.0.0.1:${fallback}`;
  } catch {
    return url;
  }
}

function routePreferences() {
  return {
    assetsTab: localStorage.getItem("premiere316.assets-tab") || "prompts",
    directTab: localStorage.getItem("premiere316.direct-tab") || "sequence"
  };
}

function routeUrl(route: string, projectSlug?: string | null) {
  const params = new URLSearchParams();
  if (projectSlug) params.set("project", projectSlug);
  return `${route}${params.size ? `?${params}` : ""}`;
}

export default function App() {
  const store = useStore();
  const [route, setRoute] = useState(() => resolveProductionRoute(window.location.pathname, routePreferences()));
  const [piOpen, setPiOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [comfyDialogOpen, setComfyDialogOpen] = useState(false);
  const section = routeSection(route);
  const subtab = routeSubtab(route);

  const navigate = useCallback((requested: string, replace = false) => {
    const next = resolveProductionRoute(requested, routePreferences());
    const url = routeUrl(next, useStore.getState().project?.slug);
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    setRoute(next);
  }, []);

  useEffect(() => {
    if (route === "/edit") store.setWorkbench("prompt");
    if (route === "/generate" || route === "/direct/sequence") store.setWorkbench("guide");
    if (route === "/master" || route === "/export") store.setWorkbench("master");
  }, [route]);

  useEffect(() => {
    const canonical = resolveProductionRoute(window.location.pathname, routePreferences());
    if (canonical !== window.location.pathname.toLowerCase().replace(/\/$/, "")) {
      window.history.replaceState({}, "", routeUrl(canonical, new URLSearchParams(window.location.search).get("project")));
    }
    const onPopState = () => setRoute(resolveProductionRoute(window.location.pathname, routePreferences()));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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

  useEffect(() => {
    if (!store.project) return;
    const normalized = store.project.settings?.skipScreenplay ? routeForShorts(route) : route;
    if (normalized !== route) return void navigate(normalized, true);
    const currentProject = new URLSearchParams(window.location.search).get("project");
    if (currentProject !== store.project.slug) window.history.replaceState({}, "", routeUrl(route, store.project.slug));
  }, [store.project?.slug, route]);

  useEffect(() => {
    if (section === "assets" && subtab) localStorage.setItem("premiere316.assets-tab", subtab);
    if (section === "direct" && subtab) localStorage.setItem("premiere316.direct-tab", subtab);
  }, [section, subtab]);

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
  const closeProject = () => {
    store.closeProject();
    window.history.replaceState({}, "", route);
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
      onStartCurrent={!store.health.comfy && store.health.capabilities?.managedComfyControl ? startCurrentComfyUI : undefined}
    />
  );

  if (!store.project) return <><ProjectGate onConnectComfyUI={openComfyDialog} /><PiExpertDock activePage="project-gate" open={piOpen} onOpenChange={setPiOpen} />{comfyDialog}</>;

  const isShorts = store.project.category === "shorts" || store.project.settings?.skipScreenplay === true;
  const activeJobs = store.jobs.filter((job: any) => ["queued", "running", "cancelling"].includes(job.status));
  const upstreamQueueCount = Number(store.health.comfyQueue?.running || 0) + Number(store.health.comfyQueue?.pending || 0);
  const queueUnsafe = activeJobs.length > 0 || upstreamQueueCount > 0;
  const running = Math.max(activeJobs.length, upstreamQueueCount);
  const comfyEndpoint = endpointLabel(store.health.comfyUrl, 8188);
  const managedComfyControl = Boolean(store.health.capabilities?.managedComfyControl);

  const renderWorkspace = () => {
    if (route === "/screenplay" && !isShorts) return <ScreenplayWorkspace onOpenEditor={() => navigate("/edit")} onOpenAssets={() => navigate("/assets/prompts")} />;
    if (section === "assets") return <AssetsWorkspaceOutlet tab={subtab || "prompts"} onNavigate={navigate} onOpenEditor={() => navigate("/direct/sequence")} />;
    if (route === "/sound") return <CreateSoundWorkspace key={store.project.slug} />;
    if (route === "/storyboard") return <StoryboardWorkspace onOpenAssets={() => navigate("/assets/library")} />;
    if (section === "direct") return <DirectWorkspace tab={subtab || "sequence"} onOpenAssets={() => navigate("/assets/library")} onReviewOutputs={() => navigate("/assets/generate")} />;
    return <CreativeWorkspace onOpenAssets={() => navigate("/assets/library")} />;
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand-button" onClick={closeProject} title="Back to projects">
          <span className="brand-mark">Pr</span>
          <span className="brand-copy"><strong>Premiere<span>316</span></strong><small>AI Director</small></span>
        </button>

        <button className="project-switcher" onClick={closeProject}>
          <span className="muted">Project:</span><b>{store.project.name}</b>{isShorts ? <span className="muted"> · shorts</span> : null}<span className="chevron">⌄</span>
        </button>

        <nav className="primary-nav" aria-label="Workspace navigation">
          {isShorts ? null : <button className={section === "screenplay" ? "active" : ""} onClick={() => navigate("/screenplay")}>Screenplay</button>}
          <button className={section === "assets" ? "active" : ""} onClick={() => navigate(`/assets/${localStorage.getItem("premiere316.assets-tab") || "prompts"}`)}>Assets</button>
          <button className={section === "sound" ? "active" : ""} onClick={() => navigate("/sound")}>Create Sound</button>
          <button className={section === "storyboard" ? "active" : ""} onClick={() => navigate("/storyboard")}>Storyboard</button>
          <button className={section === "direct" ? "active" : ""} onClick={() => navigate(`/direct/${localStorage.getItem("premiere316.direct-tab") || "sequence"}`)}>Direct</button>
          <button className={section === "edit" ? "active" : ""} onClick={() => navigate("/edit")}>Edit</button>
          <button className={section === "generate" ? "active" : ""} onClick={() => navigate("/generate")}>Generate</button>
          <button className={section === "master" ? "active" : ""} onClick={() => navigate("/master")}>Master</button>
          <button className={section === "export" ? "active" : ""} onClick={() => navigate("/export")}>Export</button>
        </nav>

        <div className="header-actions">
          <button className="premiere-restart-button" disabled={store.premiereRestartBusy || !store.health.capabilities?.premiereRestart} title="Restart the Premiere316 app server on port 8789, reconnect, and reload this page." onClick={() => { if (window.confirm("Restart Premiere316 now? The app will reconnect and reload automatically.")) void store.restartPremiere316(); }}>{store.premiereRestartBusy ? "RESTARTING APP…" : "↻ RESTART APP"}</button>
          <span className={`connection-pill ${store.health.comfy ? "online" : "offline"}`} title={store.health.comfyUrl || "http://127.0.0.1:8188"}><span className="connection-dot" />{store.health.comfy ? `ComfyUI ${endpointLabel(store.health.comfyUrl, 8188)}` : `ComfyUI Offline ${endpointLabel(store.health.comfyUrl, 8188)}`}</span>
          <button
            className="pi-header-button"
            disabled={store.comfyConnectBusy || store.comfyRestartBusy || store.health.comfyRestarting || queueUnsafe || !managedComfyControl}
            title={comfyControlTitle({ online: store.health.comfy, managed: managedComfyControl, queueUnsafe, endpoint: comfyEndpoint })}
            onClick={() => {
              if (!store.health.comfy) return void store.restartComfyUI();
              if (window.confirm(`Restart ComfyUI ${comfyEndpoint} now? The generation queue must be idle.`)) void store.restartComfyUI();
            }}
          >
            {comfyControlLabel({
              online: store.health.comfy,
              busy: store.comfyRestartBusy || store.health.comfyRestarting,
              status: store.health.comfyRestartStatus
            })}
          </button>
          {section === "screenplay" ? <span className={`connection-pill ${store.health.screenplayModelAvailable ? "online" : "offline"}`} title={store.health.screenplayModel}><span className="connection-dot" />{store.health.screenplayModelAvailable ? "LM Studio · Qwen 40B" : "LM Studio model offline"}</span> : null}
          <button className="icon-button" title="Save project" onClick={() => store.saveProject()}>⌘S</button>
          <button className="icon-button" title="Global generation queue" aria-expanded={queueOpen} onClick={() => setQueueOpen((value) => !value)}>◫{running ? <em>{running}</em> : null}</button>
          <button className={`pi-header-button ${piOpen ? "active" : ""}`} title="Open Pi ComfyUI Expert" onClick={() => setPiOpen((value) => !value)}><span>π</span> Pi Expert</button>
          <button className="icon-button" title="ComfyUI connection settings" onClick={openComfyDialog}>⚙</button>
          <span className="avatar">TJ</span>
        </div>
      </header>

      {store.error ? <button className="error-banner" onClick={() => store.setError(null)}><span>!</span><b>{store.error}</b><small>Click to dismiss</small></button> : null}
      <ProjectContextStrip />
      {section === "assets" || section === "direct" ? (
        <nav className="workspace-subnav" aria-label={`${section === "assets" ? "Assets" : "Direct"} workspaces`}>
          {(section === "assets" ? ASSET_NAV : DIRECT_NAV).map(([id, label]) => <button key={id} aria-current={subtab === id ? "page" : undefined} className={subtab === id ? "active" : ""} onClick={() => navigate(`/${section}/${id}`)}>{label}</button>)}
        </nav>
      ) : null}
      {renderWorkspace()}
      <GlobalQueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
      <PiExpertDock activePage={section} open={piOpen} onOpenChange={setPiOpen} />
      {comfyDialog}
    </div>
  );
}
