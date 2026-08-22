import React from "react";
import { useStore } from "../store";
import { openAssetAction } from "../contextual-agency";

function productionLocation(id: string | null) {
  if (!id) return "No shot selected";
  const match = id.match(/^H(\d+)-S(\d+)-C(\d+)$/i);
  if (!match) return id;
  return `Chapter ${Number(match[1])} / Scene ${Number(match[2])} / Clip ${match[3]}`;
}

function gibibytes(bytes: number) {
  return `${(Math.max(0, Number(bytes) || 0) / (1024 ** 3)).toFixed(1)} GB`;
}

export default function ProjectContextStrip({ onOpenQueue }: { onOpenQueue?: () => void }) {
  const store = useStore();
  const project = store.project;
  if (!project) return null;

  const selectedAsset = project.assets?.items?.find((item: any) => item.id === store.selectedAssetId) || null;
  const screenplayApproval = project.screenplay?.approval;
  const screenplayRevision = String(project.screenplay?.revision || screenplayApproval?.screenplayRevision || "");
  const manifestRevision = String(project.assets?.screenplayHash || "");
  const continuityCurrent = Boolean(screenplayApproval?.status === "approved" || (screenplayRevision && manifestRevision && screenplayRevision === manifestRevision));
  const projectJobs = store.jobs.filter((job: any) => job.projectSlug === project.slug);
  const waiting = projectJobs.filter((job: any) => job.status === "queued").length + Number(store.health.comfyQueue?.pending || 0);
  const running = Math.max(projectJobs.filter((job: any) => ["running", "cancelling"].includes(job.status)).length, Number(store.health.comfyQueue?.running || 0));
  const awaitingReview = projectJobs.filter((job: any) => job.status === "awaiting_review").length;
  const blocked = projectJobs.filter((job: any) => job.status === "error").length;
  const promoted = projectJobs.filter((job: any) => job.status === "promoted").length;
  const gpu = store.health.gpu;
  const clipId = store.productionClipId || store.selClipId;

  const openShot = () => {
    if (!clipId) return;
    openAssetAction({
      sourceRoute: "/direct/sequence",
      sourceEntity: { type: "sequence", id: String(clipId), label: productionLocation(clipId) },
      requirement: { relationship: "sequence.media", category: "video", expectedMediaType: "video" },
      initialAction: "choose",
      slotState: "missing",
      returnFocusId: "nav-002-shot"
    });
  };

  const openAsset = () => {
    if (!selectedAsset) return;
    openAssetAction({
      sourceRoute: "/library",
      sourceEntity: { type: "library", id: selectedAsset.id, label: selectedAsset.name },
      requirement: { relationship: "library.asset", category: "atmosphere", assetId: selectedAsset.id },
      initialAction: selectedAsset.approvalCurrent === false ? "review" : "choose",
      slotState: selectedAsset.approvalCurrent === false ? "unapproved" : "approved",
      returnFocusId: "nav-002-asset"
    });
  };

  return (
    <section className="project-context-strip" aria-label="Shared production context">
      <div className="context-primary">
        <b>{project.name}</b>
        <button type="button" id="nav-002-shot" data-testid="nav-002-shot" onClick={openShot}>{productionLocation(clipId)}</button>
        {selectedAsset ? <button type="button" id="nav-002-asset" data-testid="nav-002-asset" title={selectedAsset.id} onClick={openAsset}>Asset: {selectedAsset.name}</button> : null}
      </div>
      <div className="context-badges">
        <span className={screenplayApproval?.status === "approved" ? "context-good" : "context-warning"}>
          Screenplay {screenplayApproval?.status === "approved" ? "Approved" : "Draft"}{screenplayRevision ? ` · ${screenplayRevision.slice(0, 8)}` : ""}
        </span>
        <span className={continuityCurrent ? "context-good" : "context-warning"}>
          Asset manifest {continuityCurrent ? "Current" : "Review Required"}
        </span>
        <button
          type="button"
          className={running ? "context-busy" : awaitingReview || blocked ? "context-warning" : promoted ? "context-good" : "context-neutral"}
          data-testid="nav-002-queue"
          onClick={() => onOpenQueue?.()}
        >
          Queue: {running || waiting ? `${running} running · ${waiting} waiting` : awaitingReview ? `${awaitingReview} awaiting review` : blocked ? `${blocked} blocked` : promoted ? `${promoted} promoted` : "Idle"}
        </button>
      </div>
      <details className="provider-status-popover">
        <summary className={store.health.comfy ? "context-good" : "context-warning"}>
          GPU activity: {gpu?.leaseOwner || (store.health.comfy ? "Idle" : "Unavailable")}
        </summary>
        <div className="provider-status-card">
          <header><b>Local production services</b><small>Shared runtime state</small></header>
          <dl>
            <div><dt>LM Studio</dt><dd className={store.health.lmStudio ? "good" : "bad"}>{store.health.lmStudio ? "Ready" : "Offline"}</dd></div>
            <div><dt>ComfyUI</dt><dd className={store.health.comfy ? "good" : "bad"}>{store.health.comfy ? `Connected · ${store.health.comfyUrl}` : "Offline"}</dd></div>
            <div><dt>GPU</dt><dd>{gpu ? `${gibibytes(gpu.usedBytes)} / ${gibibytes(gpu.totalBytes)}` : "Not reported"}</dd></div>
            <div><dt>Inferred owner</dt><dd>{gpu?.leaseOwner || "Idle"}</dd></div>
            <div><dt>Upstream queue</dt><dd>{store.health.comfyQueue?.running || 0} running · {store.health.comfyQueue?.pending || 0} waiting</dd></div>
          </dl>
        </div>
      </details>
    </section>
  );
}
