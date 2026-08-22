import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import AssetActionDrawer from "./components/AssetActionDrawer";
import PiExpertDock from "./components/PiExpertDock";
import ComfyConnectionDialog from "./components/ComfyConnectionDialog";
import { resolveProductionRoute, routeForShorts, routeSection, routeSubtab } from "./navigation";
import { comfyControlLabel, comfyControlTitle } from "./comfy-control";
import {
  buildMissingWorkIndex,
  openAssetAction,
  resultActions,
  useAssetActionStore,
  type AssetActionIntent,
  type MissingWorkItem
} from "./contextual-agency";

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

const WORKSPACE_ROUTE: Record<string, string> = {
  characters: "/assets/characters",
  storyboard: "/storyboard",
  sound: "/sound",
  ltx: "/ltx",
  sequence: "/direct/sequence",
  master: "/master",
  export: "/export",
  library: "/library",
  comfy: "/comfy"
};

const NAV_COUNT_KEYS: Record<string, string[]> = {
  assets: ["library", "characters"],
  sound: ["sound"],
  storyboard: ["storyboard"],
  direct: ["sequence", "ltx", "comfy"],
  master: ["master"],
  export: ["export"]
};

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

function collectMissingWork(project: any, jobs: any[], health: any) {
  const clips = project?.sequence?.clips || [];
  const characters = project?.characters || project?.assets?.characters || [];
  const soundCues = project?.sound?.dialogueCues || project?.dialogueCues || [];
  const ltxGuides = clips.map((clip: any) => ({
    id: clip.id,
    label: clip.name,
    first: clip.guides?.find((guide: any) => guide.role === "first" || Number(guide.frame) === 0) || clip.firstFrame,
    last: clip.guides?.find((guide: any) => guide.role === "last")
  }));
  const sequenceSlots = clips.map((clip: any) => {
    const active = clip.versions?.find((version: any) => Number(version.v) === Number(clip.activeVersion));
    return { id: clip.id, label: clip.name, file: active?.file || clip.file, approvalCurrent: Boolean(clip.activeVersion) };
  });
  const activeScore = project?.score?.versions?.find((version: any) => Number(version.v) === Number(project.score.activeVersion));
  const masterScore = project?.score === undefined ? undefined : {
    file: activeScore?.file,
    approvalCurrent: Boolean(activeScore),
    activeVersion: project.score?.activeVersion
  };
  const activeMaster = project?.masters?.find((version: any) => Number(version.v) === Number(project.activeMasterVersion))
    || project?.masters?.[project?.masters?.length - 1];
  const exportBlockers = [];
  if (!activeMaster) exportBlockers.push({ id: "master", label: "Missing master", relationship: "export.master" });
  if (!activeScore) exportBlockers.push({ id: "score", label: "Missing score", relationship: "master.score" });
  if (!health?.comfy) exportBlockers.push({ id: "comfy", label: "ComfyUI offline", relationship: "export.comfy" });
  const libraryAssets = (project?.assets?.items || []).filter((item: any) => !item.file || item.approvalCurrent === false);
  const comfyJobs = (jobs || []).filter((job: any) => ["error", "failed"].includes(String(job.status || "").toLowerCase()));
  return buildMissingWorkIndex({
    characters,
    soundCues,
    ltxGuides,
    sequenceSlots,
    masterScore,
    exportBlockers,
    libraryAssets,
    comfyJobs
  });
}

function entityTypeForItem(item: MissingWorkItem): AssetActionIntent["sourceEntity"]["type"] {
  if (item.entityType === "character") return "character";
  if (item.entityType === "segment") return "segment";
  if (item.entityType === "guide") return "guide";
  if (item.entityType === "master") return "master";
  if (item.entityType === "export-blocker") return "export-blocker";
  if (item.entityType === "library") return "library";
  return "sequence";
}

function intentFromMissingItem(item: MissingWorkItem): AssetActionIntent {
  return {
    sourceRoute: WORKSPACE_ROUTE[item.workspace] || "/edit",
    sourceEntity: { type: entityTypeForItem(item), id: item.entityId, label: item.entityLabel },
    requirement: { relationship: item.relationship, category: item.category },
    initialAction: item.state === "unapproved" ? "review" : "generate",
    slotState: item.state,
    returnFocusId: `nav-001-${item.workspace}`
  };
}

function openComfyBlocked() {
  openAssetAction({
    sourceRoute: "/comfy",
    sourceEntity: { type: "sequence", id: "comfy-offline", label: "ComfyUI offline" },
    requirement: { relationship: "comfy.offline", category: "atmosphere", expectedMediaType: "image" },
    initialAction: "choose",
    slotState: "broken",
    returnFocusId: "nav-014-comfy"
  });
}

function navCount(counts: Record<string, number>, keys: string[] = []) {
  return keys.reduce((sum, key) => sum + Number(counts[key] || 0), 0);
}

export default function App() {
  const store = useStore();
  const agencyIntent = useAssetActionStore((state) => state.intent);
  const lastResult = useAssetActionStore((state) => state.lastResult);
  const [route, setRoute] = useState(() => resolveProductionRoute(window.location.pathname, routePreferences()));
  const [piOpen, setPiOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [comfyDialogOpen, setComfyDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<{ intent: AssetActionIntent; result: any } | null>(null);
  const lastIntentRef = useRef<AssetActionIntent | null>(null);
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

  useEffect(() => {
    if (agencyIntent) lastIntentRef.current = agencyIntent;
  }, [agencyIntent]);

  useEffect(() => {
    if (lastResult && (agencyIntent || lastIntentRef.current)) {
      setToast({ intent: agencyIntent || lastIntentRef.current!, result: lastResult });
    }
  }, [lastResult, agencyIntent]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const missingWork = useMemo(
    () => collectMissingWork(store.project, store.jobs, store.health),
    [store.project, store.jobs, store.health]
  );

  const openMissing = (workspace?: string) => {
    const item = missingWork.items.find((entry) => !workspace || entry.workspace === workspace) || missingWork.items[0];
    if (!item) return;
    const routeForItem = WORKSPACE_ROUTE[item.workspace];
    if (routeForItem) navigate(routeForItem.startsWith("/ltx") || routeForItem.startsWith("/comfy") || routeForItem.startsWith("/library")
      ? item.workspace === "ltx" ? "/direct/ltx"
        : item.workspace === "comfy" ? "/direct/comfyui"
        : item.workspace === "library" ? "/assets/library"
        : routeForItem
      : routeForItem);
    openAssetAction(intentFromMissingItem(item));
  };

  const retryLast = () => {
    const intent = lastIntentRef.current;
    if (intent) openAssetAction({ ...intent, initialAction: intent.initialAction || "generate" });
  };

  const runResultAction = (action: { id: string; kind: string }) => {
    const intent = toast?.intent || lastIntentRef.current;
    if (!intent) return;
    if (action.id === "continue-missing" || action.kind === "continue") {
      setToast(null);
      openMissing();
      return;
    }
    openAssetAction({
      ...intent,
      initialAction: action.kind === "review" ? "review" : action.kind === "versions" ? "versions" : "attach"
    });
  };

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
  const paletteItems = missingWork.items.slice(0, 8);

  const renderWorkspace = () => {
    if (route === "/screenplay" && !isShorts) return <ScreenplayWorkspace onOpenEditor={() => navigate("/edit")} onOpenAssets={() => navigate("/assets/prompts")} />;
    if (section === "assets") return <AssetsWorkspaceOutlet tab={subtab || "prompts"} onNavigate={navigate} onOpenEditor={() => navigate("/direct/sequence")} />;
    if (route === "/sound") return <CreateSoundWorkspace key={store.project.slug} />;
    if (route === "/storyboard") return <StoryboardWorkspace onOpenAssets={() => navigate("/assets/library")} />;
    if (section === "direct") return <DirectWorkspace tab={subtab || "sequence"} onOpenAssets={() => navigate("/assets/library")} onReviewOutputs={() => navigate("/assets/generate")} />;
    return <CreativeWorkspace onOpenAssets={() => navigate("/assets/library")} />;
  };

  const navButton = (id: string, label: string, href: string, active: boolean) => {
    const count = navCount(missingWork.counts, NAV_COUNT_KEYS[id]);
    const firstKey = NAV_COUNT_KEYS[id]?.[0];
    return (
      <span key={id} className="nav-item-wrap">
        <button
          id={`nav-001-${id}`}
          className={active ? "active" : ""}
          data-testid={`nav-001-${id}`}
          onClick={() => navigate(href)}
        >
          {label}
        </button>
        {count ? (
          <button
            type="button"
            className="nav-missing-count"
            data-testid={`nav-001-count-${id}`}
            title={`Open first missing ${id} item`}
            onClick={() => openMissing(firstKey)}
          >{count}</button>
        ) : null}
      </span>
    );
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
          {navButton("assets", "Assets", `/assets/${localStorage.getItem("premiere316.assets-tab") || "prompts"}`, section === "assets")}
          {navButton("sound", "Create Sound", "/sound", section === "sound")}
          {navButton("storyboard", "Storyboard", "/storyboard", section === "storyboard")}
          {navButton("direct", "Direct", `/direct/${localStorage.getItem("premiere316.direct-tab") || "sequence"}`, section === "direct")}
          <button className={section === "edit" ? "active" : ""} onClick={() => navigate("/edit")}>Edit</button>
          <button className={section === "generate" ? "active" : ""} onClick={() => navigate("/generate")}>Generate</button>
          {navButton("master", "Master", "/master", section === "master")}
          {navButton("export", "Export", "/export", section === "export")}
        </nav>

        <div className="header-actions">
          <button className="premiere-restart-button" disabled={store.premiereRestartBusy || !store.health.capabilities?.premiereRestart} title="Restart the Premiere316 app server on port 8789, reconnect, and reload this page." onClick={() => { if (window.confirm("Restart Premiere316 now? The app will reconnect and reload automatically.")) void store.restartPremiere316(); }}>{store.premiereRestartBusy ? "RESTARTING APP…" : "↻ RESTART APP"}</button>
          <button
            type="button"
            id="nav-014-comfy"
            data-testid="nav-014-comfy"
            className={`connection-pill ${store.health.comfy ? "online" : "offline"}`}
            title={store.health.comfyUrl || "http://127.0.0.1:8188"}
            onClick={() => { if (!store.health.comfy) openComfyBlocked(); }}
          >
            <span className="connection-dot" />{store.health.comfy ? `ComfyUI ${endpointLabel(store.health.comfyUrl, 8188)}` : `ComfyUI Offline ${endpointLabel(store.health.comfyUrl, 8188)}`}
          </button>
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
          <button className="icon-button" title="Search actions" data-testid="nav-015-open" onClick={() => setPaletteOpen(true)}>⌘K</button>
          <button className="icon-button" title="Global generation queue" aria-expanded={queueOpen} data-testid="nav-022-queue" onClick={() => setQueueOpen((value) => !value)}>◫{running ? <em>{running}</em> : null}</button>
          <button className={`pi-header-button ${piOpen ? "active" : ""}`} title="Open Pi ComfyUI Expert" onClick={() => setPiOpen((value) => !value)}><span>π</span> Pi Expert</button>
          <button className="icon-button" title="ComfyUI connection settings" onClick={openComfyDialog}>⚙</button>
          <span className="avatar">TJ</span>
        </div>
      </header>

      {store.error ? (
        <div className="error-banner" data-testid="nav-004-error">
          <span>!</span>
          <b>{store.error}</b>
          <button type="button" className="button secondary" data-testid="nav-004-retry" onClick={retryLast}>Retry last action</button>
          <button type="button" className="button secondary" data-testid="nav-019-retry" onClick={retryLast}>Retry</button>
          <button type="button" onClick={() => store.setError(null)}>Dismiss</button>
        </div>
      ) : null}
      {toast ? (
        <aside className="success-toast" data-testid="nav-005-toast">
          <b>Ready</b>
          {resultActions(toast.intent, toast.result).map((action) => (
            <button key={action.id} type="button" onClick={() => runResultAction(action)}>{action.label}</button>
          ))}
          <button type="button" onClick={() => setToast(null)}>Dismiss</button>
        </aside>
      ) : null}
      <ProjectContextStrip onOpenQueue={() => setQueueOpen(true)} />
      {section === "assets" || section === "direct" ? (
        <nav className="workspace-subnav" aria-label={`${section === "assets" ? "Assets" : "Direct"} workspaces`}>
          {(section === "assets" ? ASSET_NAV : DIRECT_NAV).map(([id, label]) => <button key={id} aria-current={subtab === id ? "page" : undefined} className={subtab === id ? "active" : ""} onClick={() => navigate(`/${section}/${id}`)}>{label}</button>)}
        </nav>
      ) : null}
      {renderWorkspace()}
      <GlobalQueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
      <AssetActionDrawer />
      <PiExpertDock activePage={section} open={piOpen} onOpenChange={setPiOpen} />
      {comfyDialog}
      {paletteOpen ? (
        <div className="command-palette-backdrop" data-testid="nav-015-palette" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
          <aside className="command-palette" role="dialog" aria-label="Command palette">
            <header><b>Go to missing work</b><small>Router only</small></header>
            {paletteItems.length ? paletteItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setPaletteOpen(false);
                  openAssetAction(intentFromMissingItem(item));
                }}
              >
                {item.entityLabel} · {item.relationship}
              </button>
            )) : <p>No missing work.</p>}
            <button type="button" onClick={() => { setPaletteOpen(false); retryLast(); }}>Retry last action</button>
            {!store.health.comfy ? <button type="button" onClick={() => { setPaletteOpen(false); openComfyBlocked(); }}>ComfyUI offline · choose / upload</button> : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
