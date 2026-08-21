import React, { useRef, useState } from "react";
import { useStore } from "../store";

export default function ComfyUIWorkspace({ onOpenAssets, onReviewOutputs }: { onOpenAssets: () => void; onReviewOutputs: () => void }) {
  const store = useStore();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("ComfyUI is loading through Premiere316's fixed local gateway.");
  const project = store.project!;
  const selectedAsset = project.assets?.items?.find((item: any) => item.id === store.selectedAssetId) || null;

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
    setNotice("Queue command sent to the visible ComfyUI workflow.");
  };

  return (
    <main className={`comfyui-workspace ${focusMode ? "focus-mode" : ""}`}>
      <header className="comfy-bridge-toolbar">
        <div className="comfy-server-state"><span className={store.health.comfy ? "online" : "offline"}><i />Server: {store.health.comfy ? store.health.comfyUrl?.replace(/^https?:\/\//, "") : "Offline"}</span><span>Queue: {store.health.comfyQueue?.running || 0} running · {store.health.comfyQueue?.pending || 0} waiting</span></div>
        <div className="comfy-bridge-context"><span><small>Workflow</small><b>{selectedAsset?.workflow?.label || selectedAsset?.workflowId || "Visible ComfyUI workflow"}</b></span><span><small>Project</small><b>{project.name}</b></span><span><small>Shot</small><b>{store.productionClipId || "Not selected"}</b></span></div>
        <div className="comfy-bridge-actions"><button className="button secondary" onClick={onOpenAssets}>Open Selected Asset</button><button className="button secondary" disabled={!selectedAsset?.prompt} onClick={copyPromptPackage}>Copy Selected Prompt</button><button className="button primary" disabled={!loaded || !store.health.comfy} title="Queues the visible workflow directly in ComfyUI's manual upstream queue." onClick={queueVisibleWorkflow}>Queue in ComfyUI</button><button className="button secondary" onClick={onReviewOutputs}>Open Asset Review</button><button className="button secondary" onClick={() => setFocusMode((value) => !value)}>{focusMode ? "Exit Focus" : "Focus Mode"}</button></div>
      </header>
      <div className="comfy-bridge-notice" role="status" aria-live="polite"><span>{notice}</span><small>The gateway target is fixed by Premiere316 settings; requests cannot select an arbitrary upstream server.</small></div>
      {store.health.comfyProxyReady ? (
        <iframe ref={frameRef} className="comfy-embedded-frame" src={store.health.comfyEmbedUrl || "/integrations/comfyui/"} title="ComfyUI inside Premiere316" onLoad={() => { setLoaded(true); setNotice("ComfyUI is ready inside Premiere316."); }} />
      ) : (
        <section className="comfy-offline premium-panel"><span>◇</span><h1>ComfyUI is offline</h1><p>Connect the configured local engine from the global header. Premiere316 will keep this workspace on the same origin when it becomes available.</p></section>
      )}
    </main>
  );
}
