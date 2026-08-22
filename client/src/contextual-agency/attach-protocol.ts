import type { AssetActionIntent } from "./types";

export type ContextualResult = {
  assetId: string;
  version?: number;
  file?: string;
  approved?: boolean;
  kind: "created" | "generated" | "uploaded" | "imported" | "assigned";
};

export type ResultAction = {
  id: string;
  label: string;
  kind: "attach" | "review" | "versions" | "continue";
};

export function resultActions(intent: AssetActionIntent, result: ContextualResult): ResultAction[] {
  const actions: ResultAction[] = [];
  const entity = intent.sourceEntity.type;
  if (entity === "library") {
    actions.push(
      { id: "attach-character", label: "Attach to Character Bible", kind: "attach" },
      { id: "attach-storyboard", label: "Attach to current Storyboard clip or frame", kind: "attach" },
      { id: "attach-guide", label: "Use as current guide", kind: "attach" },
      { id: "place-playhead", label: "Place on timeline", kind: "attach" },
      { id: "replace-slot", label: "Replace current slot", kind: "attach" }
    );
  } else if (entity === "character") {
    actions.push({ id: "attach-character", label: `Attach to ${intent.sourceEntity.label}`, kind: "attach" });
  } else if (entity === "segment" || entity === "storyboard-frame" || entity === "clip") {
    const rel = String(intent.requirement?.relationship || "");
    const ltxCue = rel === "ltx.dialogueCue";
    const cue = rel.includes("dialogue") || rel.includes("cue") || intent.requirement?.category === "dialogue";
    actions.push({ id: ltxCue ? "attach-ltx-cue" : "attach-storyboard", label: ltxCue ? "Attach to LTX dialogue cue" : cue ? "Attach to this cue" : `Attach to ${intent.sourceEntity?.label || "slot"}`, kind: "attach" });
  } else if (entity === "guide") {
    const rel = String(intent.requirement?.relationship || "");
    const last = rel === "ltx.lastGuide" || rel === "ltx.temporalGuide.last" || rel === "last guide" || rel.endsWith(".last") || rel.includes("lastGuide");
    actions.push({ id: last ? "attach-guide-last" : "attach-guide", label: last ? "Use as last" : "Use as first", kind: "attach" });
  } else if (entity === "timeline-item") {
    actions.push({ id: "place-playhead", label: "Place at playhead", kind: "attach" });
  } else {
    actions.push({ id: "attach-slot", label: `Attach to ${intent.sourceEntity.label}`, kind: "attach" });
  }
  if (!result.approved) actions.push({ id: "review-now", label: "Review now", kind: "review" });
  actions.push({ id: "open-versions", label: "Open version history", kind: "versions" });
  actions.push({ id: "continue-missing", label: "Continue to next missing requirement", kind: "continue" });
  return actions;
}

export function describeAttach(intent: AssetActionIntent, result: ContextualResult) {
  return {
    sourceEntity: intent.sourceEntity,
    relationship: intent.requirement.relationship,
    assetId: result.assetId,
    version: result.version ?? null,
    approved: Boolean(result.approved),
    operation: result.kind,
    sourceRoute: intent.sourceRoute
  };
}
