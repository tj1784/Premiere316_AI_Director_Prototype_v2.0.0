import React, { useEffect, useMemo, useRef, useState } from "react";
import { openAssetAction } from "../contextual-agency";
import { useStore } from "../store";

function openComfySlot(intent: any) {
  openAssetAction({
    sourceRoute: "/comfy",
    ...intent
  });
}

function comfyCategory(asset: any) {
  const raw = String(asset?.category || "").toLowerCase();
  if (raw === "graphic") return "artifact";
  if (["character", "wardrobe", "location", "artifact", "extra", "atmosphere", "guide-frame", "video"].includes(raw)) return raw;
  return "atmosphere";
}

function comfyMedia(asset: any): "image" | "audio" | "video" {
  const value = `${asset?.type || ""} ${asset?.mediaType || ""} ${asset?.expectedMediaType || ""}`.toLowerCase();
  if (value.includes("audio")) return "audio";
  if (value.includes("video")) return "video";
  return "image";
}


function injectGraph(frame: HTMLIFrameElement | null, graph: any) {
  const win = frame?.contentWindow as any;
  const app = win?.app || win?.comfyApp;
  if (!app) return false;
  try {
    if (graph?.nodes && typeof app.loadGraphData === "function") {
      app.loadGraphData(graph);
      return true;
    }
    if (typeof app.loadApiJson === "function") {
      app.loadApiJson(graph?.prompt || graph);
      return true;
    }
    if (typeof app.loadGraphData === "function") {
      app.loadGraphData(graph);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export default function ComfyUIWorkspace({ onOpenAssets: _onOpenAssets, onReviewOutputs: _onReviewOutputs }: { onOpenAssets: () => void; onReviewOutputs: () => void }) {
  const store = useStore();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const seenJobs = useRef(new Set<string>());
  const [focusMode, setFocusMode] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("ComfyUI is loading through Premiere316's fixed local gateway.");
  const [completedJob, setCompletedJob] = useState<any>(null);
  const [failedJob, setFailedJob] = useState<any>(null);
  const [installedWorkflows, setInstalledWorkflows] = useState<any[]>([]);
  const [workflowKey, setWorkflowKey] = useState("");
  const [embedSrc, setEmbedSrc] = useState(store.health.comfyEmbedUrl || "/integrations/comfyui/");
  const project = store.project!;
  const selectedAsset = project.assets?.items?.find((item: any) => item.id === store.selectedAssetId) || null;
  const origin = useMemo(() => {
    if (selectedAsset) {
      return {
        sourceEntity: { type: "library", id: String(selectedAsset.id), label: String(selectedAsset.name || selectedAsset.id) },
        requirement: {
          relationship: "comfy.output",
          category: comfyCategory(selectedAsset),
          expectedMediaType: comfyMedia(selectedAsset),
          assetId: selectedAsset.id,
          assetVersion: selectedAsset.activeVersion
        }
      };
    }
    if (store.productionClipId) {
      return {
        sourceEntity: { type: "sequence", id: String(store.productionClipId), label: String(store.productionClipId) },
        requirement: { relationship: "comfy.output", category: "atmosphere", expectedMediaType: "image" as const }
      };
    }
    return {
      sourceEntity: { type: "library", id: "comfy-output", label: "ComfyUI output" },
      requirement: { relationship: "comfy.output", category: "atmosphere", expectedMediaType: "image" as const }
    };
  }, [selectedAsset, store.productionClipId]);

  const comfyJobs = useMemo(() => (store.jobs || []).filter((job: any) => {
    if (job.projectSlug && job.projectSlug !== project.slug) return false;
    return /comfy|generate_asset|generate asset|workflow/i.test(`${job.type || ""} ${job.label || ""}`);
  }), [store.jobs, project.slug]);

  useEffect(() => {
    for (const job of comfyJobs) {
      const id = String(job.id || "");
      const status = String(job.status || "").toLowerCase();
      if (!id || seenJobs.current.has(`${id}:${status}`)) continue;
      seenJobs.current.add(`${id}:${status}`);
      if (["done", "completed", "complete", "succeeded"].includes(status)) {
        setCompletedJob(job);
        setFailedJob(null);
        setNotice(`Queued output finished for ${origin.sourceEntity.label}. Attach it from this slot. No download-then-upload.`);
      }
      if (["error", "failed", "cancelled"].includes(status)) {
        setFailedJob(job);
        setNotice(`${job.label || "ComfyUI job"} failed. Retry the last generate or choose an existing file.`);
      }
    }
  }, [comfyJobs, origin.sourceEntity.label]);

  const openOrigin = (action: string, extra: any = {}) => {
    openComfySlot({
      ...origin,
      initialAction: action,
      slotState: extra.slotState || (selectedAsset ? "unapproved" : "missing"),
      returnFocusId: extra.returnFocusId || `comfy-${action}`,
      ...extra
    });
  };


  useEffect(() => {
    let cancelled = false;
    const slug = project.slug || "";
    Promise.all([
      fetch(`/api/generation-workflows${slug ? `?project=${encodeURIComponent(slug)}` : ""}`).then((response) => response.json()).catch(() => ({})),
      fetch("/api/asset-workflows").then((response) => response.json()).catch(() => ({})),
      fetch("/api/aaa-workflow/library").then((response) => response.json()).catch(() => ({}))
    ]).then(([generation, assets, library]) => {
      if (cancelled) return;
      const items: any[] = [];
      const seen = new Set<string>();
      const add = (item: any) => {
        const key = String(item.key || "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        items.push(item);
      };
      for (const workflow of [...(assets.workflows || []), ...(generation.workflows || [])]) {
        const id = String(workflow.id || "");
        if (!id) continue;
        add({
          key: `cat:${id}`,
          id,
          label: String(workflow.label || workflow.name || id),
          source: "catalog",
          ready: workflow.ready,
          defaultForAsset: Boolean(selectedAsset?.workflowId && selectedAsset.workflowId === id)
        });
      }
      for (const item of library.items || []) {
        add({
          key: `lib:${item.rel}`,
          rel: item.rel,
          id: item.rel,
          label: String(item.name || item.rel),
          source: "library"
        });
      }
      setInstalledWorkflows(items);
      setWorkflowKey((current) => {
        if (current && items.some((item) => item.key === current)) return current;
        const preferred = selectedAsset?.workflowId ? `cat:${selectedAsset.workflowId}` : "";
        return items.find((item) => item.key === preferred)?.key || items[0]?.key || "";
      });
    });
    return () => { cancelled = true; };
  }, [project.slug, selectedAsset?.workflowId]);

  const loadWorkflowIntoFrame = async (key: string) => {
    const item = installedWorkflows.find((entry) => entry.key === key) || null;
    setWorkflowKey(key);
    if (!item) return;
    try {
      const query = item.rel
        ? `rel=${encodeURIComponent(item.rel)}`
        : `id=${encodeURIComponent(item.id || "")}`;
      const response = await fetch(`/api/aaa-workflow/graph?${query}`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.graph) throw new Error(json.error || "Workflow graph was not available");
      const injected = injectGraph(frameRef.current, json.graph);
      if (!injected) {
        const base = store.health.comfyEmbedUrl || "/integrations/comfyui/";
        setEmbedSrc(`${base}${base.includes("?") ? "&" : "?"}workflow=${encodeURIComponent(json.rel || item.rel || item.id || "")}`);
      }
      setNotice(`Loaded ${item.label} in ComfyUI. Not locked to the asset default.`);
    } catch (error: any) {
      setNotice(String(error.message || error));
    }
  };

  const copyPromptPackage = async () => {
    if (!selectedAsset?.prompt) return setNotice("Select an asset with a canonical prompt package first.");
    try {
      await navigator.clipboard.writeText(selectedAsset.prompt);
      setNotice(`${selectedAsset.name} prompt copied. Paste it into the selected ComfyUI text node.`);
      frameRef.current?.contentWindow?.focus();
    } catch {
      setNotice("Clipboard access was blocked. Open Prompt Development to copy the package manually.");
    }
  };

  const queueVisibleWorkflow = () => {
    const document = frameRef.current?.contentDocument;
    if (!document) return setNotice("ComfyUI is not ready yet.");
    const direct = document.querySelector<HTMLElement>("#queue-button, [data-testid='queue-button'], button[aria-label*='Queue' i]");
    const fallback = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => /^queue( prompt)?$/i.test(button.textContent?.trim() || ""));
    const button = direct || fallback;
    if (!button) return setNotice("The active ComfyUI skin did not expose a queue control to the bridge. Use its native Queue button inside the workspace.");
    button.click();
    setNotice(`Queue sent for ${origin.sourceEntity.label} · ${origin.requirement.relationship}. Output stays on this slot, not an orphan Library card.`);
  };

  return (
    <main className={`comfyui-workspace ${focusMode ? "focus-mode" : ""}`} data-testid="comfy-workspace">
      <header className="comfy-bridge-toolbar">
        <div className="comfy-server-state">
          <span className={store.health.comfy ? "online" : "offline"}><i />Server: {store.health.comfy ? store.health.comfyUrl?.replace(/^https?:\/\//, "") : "Offline"}</span>
          <span>Queue: {store.health.comfyQueue?.running || 0} running · {store.health.comfyQueue?.pending || 0} waiting</span>
        </div>
        <div className="comfy-bridge-context">
          <label className="comfy-workflow-picker"><small>Workflow</small>
            <select
              data-testid="comfy-workflow-picker"
              value={workflowKey}
              onChange={(event) => void loadWorkflowIntoFrame(event.target.value)}
            >
              {!installedWorkflows.length ? <option value="">Loading workflows…</option> : null}
              {installedWorkflows.map((item: any) => (
                <option key={item.key} value={item.key} disabled={false}>
                  {item.label}{item.source === "library" ? " · library" : ""}
                </option>
              ))}
            </select>
          </label>
          <span><small>Project</small><b>{project.name}</b></span>
          <span><small>Shot</small><b>{store.productionClipId || "Not selected"}</b></span>
          <span><small>Slot</small><b>{origin.sourceEntity.label}</b></span>
        </div>
        <div className="comfy-bridge-actions">
          <button id="comfy-review" type="button" className="button secondary" onClick={() => openOrigin("review", { returnFocusId: "comfy-review" })}>Review output</button>
          <button id="comfy-attach" type="button" className="button secondary" onClick={() => openOrigin("attach", { returnFocusId: "comfy-attach" })}>Attach to current slot</button>
          <button id="comfy-replace" type="button" className="button secondary" disabled={!selectedAsset} onClick={() => openOrigin("replace", { slotState: "unapproved", returnFocusId: "comfy-replace" })}>Save as new version</button>
          <button className="button secondary" disabled={!selectedAsset?.prompt} onClick={copyPromptPackage}>Copy Selected Prompt</button>
          <button className="button primary" disabled={!loaded || !store.health.comfy} title="Queues the visible workflow directly in ComfyUI's manual upstream queue." onClick={queueVisibleWorkflow}>Queue in ComfyUI</button>
          <button className="button secondary" onClick={() => setFocusMode((value) => !value)}>{focusMode ? "Exit Focus" : "Focus Mode"}</button>
        </div>
      </header>
      <div className="comfy-bridge-notice" role="status" aria-live="polite">
        <span>{notice}</span>
        <small>The gateway target is fixed by Premiere316 settings; requests cannot select an arbitrary upstream server.</small>
      </div>
      {completedJob ? (
        <nav className="comfy-001-ingest" data-testid="comfy-001-ingest" aria-label="Comfy output ingest">
          <b>Output ready · {completedJob.label || completedJob.id}</b>
          <small>Stays on {origin.sourceEntity.label}. Attach writes the file onto this slot.</small>
          <button type="button" className="button primary" onClick={() => openOrigin("attach", { slotState: "unapproved", returnFocusId: "comfy-attach" })}>Attach to current slot</button>
          <button type="button" className="button secondary" disabled={!selectedAsset} onClick={() => openOrigin("replace", { slotState: "unapproved", returnFocusId: "comfy-replace" })}>Save as new version</button>
          <button type="button" className="button secondary" onClick={() => openOrigin("review", { returnFocusId: "comfy-review" })}>Review</button>
          <button type="button" className="button secondary" onClick={() => { setCompletedJob(null); setNotice("Discarded this ingest. The file was not attached."); }}>Discard</button>
        </nav>
      ) : null}
      {failedJob ? (
        <nav className="comfy-005-failure" data-testid="comfy-005-failure" aria-label="Comfy failure recovery">
          <b>{failedJob.label || "ComfyUI job"} failed</b>
          <small>{failedJob.error || "Retry the last generate or choose an existing file. This is not a dead end."}</small>
          <button type="button" className="button primary" onClick={() => openOrigin("generate", { returnFocusId: "comfy-retry" })}>Retry last action</button>
          <button type="button" className="button secondary" onClick={() => openOrigin("generate", { returnFocusId: "comfy-reopen" })}>Reopen generate</button>
          <button type="button" className="button secondary" onClick={() => openOrigin("choose", { slotState: "missing", returnFocusId: "comfy-choose" })}>Choose existing</button>
        </nav>
      ) : null}
      {store.health.comfyProxyReady ? (
        <iframe ref={frameRef} className="comfy-embedded-frame" src={embedSrc} title="ComfyUI inside Premiere316" onLoad={() => { setLoaded(true); setNotice("ComfyUI is ready inside Premiere316."); }} />
      ) : (
        <section className="comfy-offline premium-panel" data-testid="comfy-005-offline">
          <span>◇</span>
          <h1>ComfyUI is offline</h1>
          <p>Generate is paused. Upload, choose, and review stay on this slot. The offline entry opens the same generate path.</p>
          <div>
            <button type="button" className="button primary" onClick={() => openOrigin("generate", { slotState: "missing", returnFocusId: "comfy-offline-generate" })}>Reopen generate</button>
            <button type="button" className="button secondary" onClick={() => openOrigin("upload", { slotState: "missing", returnFocusId: "comfy-upload" })}>Upload</button>
            <button type="button" className="button secondary" onClick={() => openOrigin("choose", { slotState: "missing", returnFocusId: "comfy-choose" })}>Choose existing</button>
            <button type="button" className="button secondary" onClick={() => openOrigin("review", { returnFocusId: "comfy-review" })}>Review</button>
          </div>
        </section>
      )}
    </main>
  );
}
