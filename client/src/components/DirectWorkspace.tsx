import React, { Suspense, lazy } from "react";
import { useStore } from "../store";
import ComfyUIWorkspace from "./ComfyUIWorkspace";

const LtxDirectorWorkspace = lazy(() => import("./LtxDirectorWorkspace.js"));
const SequenceEditorWorkspace = lazy(() => import("./SequenceEditorWorkspace.js"));

export default function DirectWorkspace({
  tab,
  onOpenAssets,
  onReviewOutputs
}: {
  tab: string;
  onOpenAssets: () => void;
  onReviewOutputs: () => void;
}) {
  const projectSlug = useStore((state) => String(state.project?.slug || ""));
  if (tab === "ltx") {
    return <Suspense fallback={<main className="workspace-route-loading"><span /><b>Loading LTX Director workspace…</b></main>}><LtxDirectorWorkspace /></Suspense>;
  }
  if (tab === "comfyui") return <ComfyUIWorkspace onOpenAssets={onOpenAssets} onReviewOutputs={onReviewOutputs} />;
  return (
    <Suspense fallback={<main className="workspace-route-loading"><span /><b>Loading full edit room…</b></main>}>
      <SequenceEditorWorkspace key={projectSlug} onOpenAssets={onOpenAssets} />
    </Suspense>
  );
}
