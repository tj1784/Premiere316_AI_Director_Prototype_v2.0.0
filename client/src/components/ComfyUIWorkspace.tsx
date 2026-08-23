import React, { useEffect, useMemo, useRef, useState } from "react";
import { openAssetAction } from "../contextual-agency";
import { useStore } from "../store";
import {
  announceLoadedAllowed,
  createWorkflowPickerState,
  graphIdentity,
  mergeWorkflowSources,
  nextRequestId
} from "@shared/comfy-workflow-state.js";

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

async function fetchJsonSource(url: string, source: string) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; }
    catch {
      return { source, error: "Invalid JSON from workflow list", status: response.status, items: [] };
    }
    if (!response.ok) {
      return { source, error: json.error || response.statusText || `HTTP ${response.status}`, status: response.status, items: [] };
    }
    return { source, status: response.status, raw: json, items: [] };
  } catch (error: any) {
    return { source, error: String(error?.message || error), status: 0, items: [] };
  }
}

function readIframeWindow(frame: HTMLIFrameElement | null) {
  try {
    return frame?.contentWindow as any || null;
  } catch (error: any) {
    throw new Error(`Cross-origin iframe is not readable: ${String(error?.message || error)}`);
  }
}

async function injectGraph(frame: HTMLIFrameElement | null, graph: any, identity: any) {
  try {
    const win = readIframeWindow(frame);
    if (!win) return { ok: false, error: "Comfy iframe is not available", ...identity };
    const app = win.app || win.comfyApp;
    if (!app) return { ok: false, error: "Comfy bridge is unavailable (no app/comfyApp)", ...identity };
    if (graph?.nodes && typeof app.loadGraphData === "function") {
      await Promise.resolve(app.loadGraphData(graph));
    } else if (typeof app.loadApiJson === "function") {
      await Promise.resolve(app.loadApiJson(graph?.prompt || graph));
    } else if (typeof app.loadGraphData === "function") {
      await Promise.resolve(app.loadGraphData(graph));
    } else {
      return { ok: false, error: "No supported graph loader on the Comfy bridge", ...identity };
    }
    return { ok: true, workflowKey: identity.workflowKey, id: identity.id, hash: identity.hash, source: identity.source };
  } catch (error: any) {
    return { ok: false, error: String(error?.message || error), ...identity };
  }
}

export default function ComfyUIWorkspace({ onOpenAssets: _onOpenAssets, onReviewOutputs: _onReviewOutputs }: { onOpenAssets: () => void; onReviewOutputs: () => void }) {
  const store = useStore();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const seenJobs = useRef(new Set<string>());
  const pickerRef = useRef(createWorkflowPickerState());
  const [focusMode, setFocusMode] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [iframeStatus, setIframeStatus] = useState<"loading" | "ready" | "timeout" | "error">("loading");
  const [notice, setNotice] = useState("ComfyUI is loading through Premiere316's fixed local gateway.");
  const [completedJob, setCompletedJob] = useState<any>(null);
  const [failedJob, setFailedJob] = useState<any>(null);
  const [installedWorkflows, setInstalledWorkflows] = useState<any[]>([]);
  const [picker, setPicker] = useState(createWorkflowPickerState());
  const [embedSrc, setEmbedSrc] = useState(store.health.comfyEmbedUrl || "/integrations/comfyui/");
  const [missingLibrary, setMissingLibrary] = useState(false);
  const project = store.project!;
  const selectedAsset = project.assets?.items?.find((item: any) => item.id === store.selectedAssetId) || null;

  const setPickerState = (patch: any) => {
    const next = { ...pickerRef.current, ...(typeof patch === "function" ? patch(pickerRef.current) : patch) };
    pickerRef.current = next;
    setPicker(next);
    return next;
  };

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
    const next = store.health.comfyEmbedUrl || "/integrations/comfyui/";
    setEmbedSrc((current) => current.split("?")[0] === next.split("?")[0] ? current : next);
  }, [store.health.comfyEmbedUrl]);

  useEffect(() => {
    if (!store.health.comfyProxyReady) return;
    setIframeStatus("loading");
    const timer = window.setTimeout(() => {
      setIframeStatus((current) => current === "ready" ? current : "timeout");
      setNotice("ComfyUI iframe did not finish loading. Retry the engine or reload the selected workflow.");
    }, 20000);
    return () => window.clearTimeout(timer);
  }, [embedSrc, store.health.comfyProxyReady]);

  useEffect(() => {
    let cancelled = false;
    const slug = project.slug || "";
    setPickerState({ listStatus: "loading", lastError: "" });
    Promise.all([
      fetchJsonSource(`/api/generation-workflows${slug ? `?project=${encodeURIComponent(slug)}` : ""}`, "catalog-generation"),
      fetchJsonSource("/api/asset-workflows", "catalog-assets"),
      fetchJsonSource("/api/aaa-workflow/library", "library")
    ]).then(([generation, assets, library]) => {
      if (cancelled) return;
      const catalogItems: any[] = [];
      for (const workflow of [...(assets.raw?.workflows || []), ...(generation.raw?.workflows || [])]) {
        const id = String(workflow.id || "");
        if (!id) continue;
        catalogItems.push({
          key: `cat:${id}`,
          id,
          label: String(workflow.label || workflow.name || id),
          source: "catalog",
          ready: workflow.ready !== false,
          hash: workflow.hash || workflow.version || "",
          defaultForAsset: Boolean(selectedAsset?.workflowId && selectedAsset.workflowId === id)
        });
      }
      const libraryItems = (library.raw?.items || []).map((item: any) => ({
        key: `${item.source || "library"}:${item.rel}`,
        rel: item.rel,
        id: item.rel,
        label: String(item.name || item.rel),
        source: item.source || "library",
        ready: true,
        hash: item.hash || "",
        defaultForAsset: false
      }));
      const merged = mergeWorkflowSources([
        { ...generation, items: [] },
        { ...assets, items: catalogItems },
        { ...library, items: libraryItems }
      ]);
      setMissingLibrary(Boolean(library.raw?.missingLibrary));
      setInstalledWorkflows(merged.items);
      setPickerState((current: any) => {
        const preferred = selectedAsset?.workflowId ? `cat:${selectedAsset.workflowId}` : "";
        const selectedKey = (current.selectedKey && merged.items.some((item) => item.key === current.selectedKey))
          ? current.selectedKey
          : merged.items.find((item) => item.key === preferred)?.key || merged.items[0]?.key || "";
        return {
          ...current,
          listStatus: merged.listStatus,
          sourceErrors: merged.sourceErrors,
          selectedKey,
          lastError: merged.sourceErrors[0]?.error || ""
        };
      });
    });
    return () => { cancelled = true; };
  }, [project.slug, selectedAsset?.workflowId]);

  const confirmReplaceLoaded = (nextKey: string) => {
    const state = pickerRef.current;
    if (!state.loadedKey || state.loadedKey === nextKey) return true;
    return window.confirm("The canvas may have unsaved graph edits. Discard them and load the selected workflow?");
  };

  const loadWorkflowIntoFrame = async (key: string, force = false) => {
    const item = installedWorkflows.find((entry) => entry.key === key) || null;
    if (!item) return;
    if (item.ready === false) {
      setNotice(`${item.label} is marked unavailable. Repair the catalog/runtime before loading.`);
      return;
    }
    if (!force && !confirmReplaceLoaded(key)) return;
    const requestId = nextRequestId(pickerRef.current);
    setPickerState({
      selectedKey: key,
      loadingKey: key,
      requestId,
      lastError: "",
      dirty: false
    });
    setNotice(`Loading ${item.label}…`);
    try {
      const query = item.rel
        ? `rel=${encodeURIComponent(item.rel)}`
        : `id=${encodeURIComponent(item.id || "")}`;
      const response = await fetch(`/api/aaa-workflow/graph?${query}`);
      const json = await response.json().catch(() => ({}));
      if (requestId !== pickerRef.current.requestId) return;
      if (!response.ok || !json.graph) throw new Error(json.error || "Workflow graph was not available");
      const identity = graphIdentity({ ...item, hash: json.hash || item.hash }, json.graph);
      const ack = await injectGraph(frameRef.current, json.graph, identity);
      if (requestId !== pickerRef.current.requestId) return;
      if (!ack.ok) {
        const base = store.health.comfyEmbedUrl || "/integrations/comfyui/";
        setEmbedSrc(`${base}${base.includes("?") ? "&" : "?"}workflow=${encodeURIComponent(json.rel || item.rel || item.id || "")}`);
        setPickerState({ lastError: ack.error || "Bridge inject failed", loadingKey: key });
        setNotice(`Could not confirm ${item.label} in the iframe. ${ack.error || "Waiting for URL fallback."}`);
        return;
      }
      if (!announceLoadedAllowed({ ...pickerRef.current, loadingKey: key }, ack)) return;
      setPickerState({
        loadedKey: key,
        loadedHash: ack.hash || identity.hash,
        loadedSource: item.source,
        loadingKey: "",
        lastError: "",
        dirty: true
      });
      setNotice(`Loaded ${item.label} · ${item.source}${identity.hash ? ` · ${identity.hash}` : ""}. Canvas ACK received.`);
    } catch (error: any) {
      if (requestId !== pickerRef.current.requestId) return;
      setPickerState({ lastError: String(error.message || error), loadingKey: "" });
      setNotice(String(error.message || error));
    }
  };

  const copyPromptPackage = async () => {
    if (!selectedAsset?.prompt) return setNotice("Select an asset with a canonical prompt package first.");
    try {
      await navigator.clipboard.writeText(selectedAsset.prompt);
      setNotice(`${selectedAsset.name} prompt copied. Paste it into the selected ComfyUI text node.`);
      try { frameRef.current?.contentWindow?.focus(); } catch {}
    } catch {
      setNotice("Clipboard access was blocked. Open Prompt Development to copy the package manually.");
    }
  };

  const queueVisibleWorkflow = async () => {
    const loaded = installedWorkflows.find((item) => item.key === picker.loadedKey);
    if (!loaded) return setNotice("Load a workflow and wait for the canvas ACK before queueing.");
    try {
      const win = readIframeWindow(frameRef.current);
      const document = (() => {
        try { return frameRef.current?.contentDocument; }
        catch (error: any) { throw new Error(`Cross-origin iframe is not readable: ${String(error?.message || error)}`); }
      })();
      if (!document && !win) return setNotice("Comfy bridge is unavailable.");
      const api = win?.app?.queuePrompt || win?.app?.queue_prompt || win?.comfyApp?.queuePrompt;
      if (typeof api === "function") {
        const result = await Promise.resolve(api.call(win.app || win.comfyApp));
        const promptId = result?.prompt_id || result?.promptId || result?.id;
        if (!promptId) throw new Error("Queue API returned no prompt ID");
        setNotice(`Queue accepted · prompt ${promptId} · ${origin.sourceEntity.label}.`);
        return;
      }
      const host = document;
      if (!host) throw new Error("No versioned queue bridge and no readable queue control");
      const direct = host.querySelector<HTMLElement>("#queue-button, [data-testid='queue-button'], button[aria-label*='Queue' i]");
      const fallback = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => /^queue( prompt)?$/i.test(button.textContent?.trim() || ""));
      const button = direct || fallback;
      if (!button) throw new Error("The active ComfyUI skin did not expose a queue control to the bridge.");
      button.click();
      setNotice("Queue click sent, but no prompt ID was returned. Treat this as unverified.");
    } catch (error: any) {
      setNotice(`Queue failed: ${String(error.message || error)}`);
    }
  };

  const loadedItem = installedWorkflows.find((item) => item.key === picker.loadedKey) || null;
  const selectedItem = installedWorkflows.find((item) => item.key === picker.selectedKey) || null;
  const listLabel = picker.listStatus === "loading"
    ? "Loading workflows…"
    : picker.listStatus === "error"
      ? "Workflow sources failed"
      : picker.listStatus === "empty"
        ? "No workflows available"
        : picker.listStatus === "partial"
          ? "Partial workflow library"
          : "Workflow";

  return (
    <main className={`comfyui-workspace ${focusMode ? "focus-mode" : ""}`} data-testid="comfy-workspace">
      <header className="comfy-bridge-toolbar">
        <div className="comfy-server-state">
          <span className={store.health.comfy ? "online" : "offline"}><i />Server: {store.health.comfy ? store.health.comfyUrl?.replace(/^https?:\/\//, "") : "Offline"}</span>
          <span>Queue: {store.health.comfyQueue?.running || 0} running · {store.health.comfyQueue?.pending || 0} waiting</span>
        </div>
        <div className="comfy-bridge-context">
          <label className="comfy-workflow-picker"><small>{listLabel}</small>
            <select
              data-testid="comfy-workflow-picker"
              aria-label="Workflow picker"
              aria-describedby="comfy-workflow-state"
              value={picker.selectedKey}
              onChange={(event) => void loadWorkflowIntoFrame(event.target.value)}
            >
              {picker.listStatus === "loading" && !installedWorkflows.length ? <option value="">Loading workflows…</option> : null}
              {picker.listStatus !== "loading" && !installedWorkflows.length ? <option value="">No workflows available</option> : null}
              {installedWorkflows.map((item: any) => (
                <option key={item.key} value={item.key} disabled={item.ready === false}>
                  {item.label}{item.source === "library" ? " · library" : item.source === "package" ? " · packaged" : ""}{item.ready === false ? " · unavailable" : ""}{item.defaultForAsset ? " · recommended" : ""}
                </option>
              ))}
            </select>
          </label>
          <span id="comfy-workflow-state" data-testid="comfy-workflow-state">
            <small>Loaded</small>
            <b>{loadedItem ? `${loadedItem.label} · ${picker.loadedSource || loadedItem.source}${picker.loadedHash ? ` · ${picker.loadedHash}` : ""}` : "Not loaded"}</b>
          </span>
          <span><small>Selected</small><b>{selectedItem?.label || "None"}</b></span>
          <span><small>Project</small><b>{project.name}</b></span>
          <span><small>Shot</small><b>{store.productionClipId || "Not selected"}</b></span>
          <span><small>Slot</small><b>{origin.sourceEntity.label}</b></span>
        </div>
        <div className="comfy-bridge-actions">
          <button type="button" className="button secondary" data-testid="comfy-reload-selected" disabled={!picker.selectedKey} onClick={() => void loadWorkflowIntoFrame(picker.selectedKey, true)}>Reload selected</button>
          <button id="comfy-review" type="button" className="button secondary" onClick={() => openOrigin("review", { returnFocusId: "comfy-review" })}>Review output</button>
          <button id="comfy-attach" type="button" className="button secondary" onClick={() => openOrigin("attach", { returnFocusId: "comfy-attach" })}>Attach to current slot</button>
          <button id="comfy-replace" type="button" className="button secondary" disabled={!selectedAsset} onClick={() => openOrigin("replace", { slotState: "unapproved", returnFocusId: "comfy-replace" })}>Save as new version</button>
          <button className="button secondary" disabled={!selectedAsset?.prompt} onClick={copyPromptPackage}>Copy Selected Prompt</button>
          <button className="button primary" disabled={!iframeReady || !store.health.comfy || !picker.loadedKey} title="Queues the verified loaded workflow." onClick={() => void queueVisibleWorkflow()}>Queue in ComfyUI</button>
          <button className="button secondary" onClick={() => setFocusMode((value) => !value)}>{focusMode ? "Exit Focus" : "Focus Mode"}</button>
        </div>
      </header>
      <div className="comfy-bridge-notice" role="status" aria-live="polite">
        <span>{notice}</span>
        <small>The gateway target is fixed by Premiere316 settings; requests cannot select an arbitrary upstream server.</small>
      </div>
      {missingLibrary ? (
        <p className="comfy-missing-library" data-testid="comfy-missing-library" role="status">Local Comfy user workflow folder is missing or empty. Packaged Premiere316 workflows remain available.</p>
      ) : null}
      {picker.sourceErrors?.length ? (
        <p className="comfy-source-errors" data-testid="comfy-source-errors" role="alert">
          {picker.sourceErrors.map((entry: any) => `${entry.source}: ${entry.error}`).join(" · ")}
        </p>
      ) : null}
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
        iframeStatus === "timeout" || iframeStatus === "error" ? (
          <section className="comfy-offline premium-panel" data-testid="comfy-iframe-timeout">
            <span>◇</span>
            <h1>{iframeStatus === "timeout" ? "ComfyUI iframe timed out" : "ComfyUI iframe failed"}</h1>
            <p>The embedded engine did not become ready. Retry without losing the selected workflow.</p>
            <div>
              <button type="button" className="button primary" onClick={() => { setIframeStatus("loading"); setEmbedSrc((value) => value); }}>Retry iframe</button>
              <button type="button" className="button secondary" disabled={!picker.selectedKey} onClick={() => void loadWorkflowIntoFrame(picker.selectedKey, true)}>Reload selected workflow</button>
            </div>
          </section>
        ) : (
          <iframe
            ref={frameRef}
            className="comfy-embedded-frame"
            src={embedSrc}
            title="ComfyUI inside Premiere316"
            onLoad={() => {
              setIframeReady(true);
              setIframeStatus("ready");
              setNotice(picker.loadedKey ? notice : "ComfyUI is ready inside Premiere316. No workflow is loaded until you select one and the canvas ACKs.");
            }}
            onError={() => setIframeStatus("error")}
          />
        )
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
