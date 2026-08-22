export const MANUAL_ACTIONS = [
  "upload", "create", "choose", "edit", "replace", "review", "assign", "attach", "restore", "unlink", "versions"
];

export const MODEL_ACTIONS = ["generate"];

export function actionsForSlotState(state) {
  switch (state) {
    case "missing":
      return ["generate", "upload", "create", "choose", "assign"];
    case "planned":
      return ["generate", "upload", "edit", "choose"];
    case "unapproved":
      return ["review", "upload", "generate", "restore", "versions"];
    case "approved":
      return ["edit", "generate", "upload", "replace", "versions", "unlink"];
    case "broken":
      return ["review", "choose", "generate", "upload", "restore"];
    default:
      return ["choose", "upload", "create"];
  }
}

export function slotStateFromAsset(asset) {
  if (!asset) return "missing";
  const file = asset.file || asset.activeFile;
  if (!file && !asset.activeVersion) return "planned";
  if (file && asset.approvalCurrent === false) return "unapproved";
  if (file && asset.approvalCurrent) return "approved";
  if (asset.activeVersion && !file) return "broken";
  return file ? "unapproved" : "planned";
}

export function resultActions(intent, result) {
  const actions = [];
  const entity = intent.sourceEntity?.type;
  if (entity === "library") {
    actions.push(
      { id: "attach-character", label: "Attach to Character Bible", kind: "attach" },
      { id: "attach-storyboard", label: "Attach to current Storyboard clip or frame", kind: "attach" },
      { id: "attach-guide", label: "Use as current guide", kind: "attach" },
      { id: "place-playhead", label: "Place on timeline", kind: "attach" },
      { id: "replace-slot", label: "Replace current slot", kind: "attach" }
    );
  } else if (entity === "character") actions.push({ id: "attach-character", label: `Attach to ${intent.sourceEntity.label}`, kind: "attach" });
  else if (entity === "segment" || entity === "storyboard-frame" || entity === "clip") {
    const rel = String(intent.requirement?.relationship || "");
    const ltxCue = rel === "ltx.dialogueCue";
    const cue = rel.includes("dialogue") || rel.includes("cue") || intent.requirement?.category === "dialogue";
    actions.push({ id: ltxCue ? "attach-ltx-cue" : "attach-storyboard", label: ltxCue ? "Attach to LTX dialogue cue" : cue ? "Attach to this cue" : `Attach to ${intent.sourceEntity?.label || "slot"}`, kind: "attach" });
  }
  else if (entity === "guide") {
    const rel = String(intent.requirement?.relationship || "");
    const last = rel === "ltx.lastGuide" || rel === "ltx.temporalGuide.last" || rel === "last guide" || rel.endsWith(".last") || rel.includes("lastGuide");
    actions.push({ id: last ? "attach-guide-last" : "attach-guide", label: last ? "Use as last" : "Use as first", kind: "attach" });
  }
  else if (entity === "timeline-item") actions.push({ id: "place-playhead", label: "Place at playhead", kind: "attach" });
  else actions.push({ id: "attach-slot", label: `Attach to ${intent.sourceEntity?.label || "slot"}`, kind: "attach" });
  if (!result.approved) actions.push({ id: "review-now", label: "Review now", kind: "review" });
  actions.push({ id: "open-versions", label: "Open version history", kind: "versions" });
  actions.push({ id: "continue-missing", label: "Continue to next missing requirement", kind: "continue" });
  return actions;
}

export function describeAttach(intent, result) {
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

export function buildMissingWorkIndex(input = {}) {
  const items = [];
  const hole = (asset) => slotStateFromAsset(asset ? { file: asset.file || asset.activeFile, approvalCurrent: asset.approvalCurrent, activeVersion: asset.activeVersion } : null);
  const pushHole = (workspace, entityType, entityId, entityLabel, relationship, category, asset) => {
    const state = hole(asset);
    if (state === "approved") return;
    items.push({ id: `${workspace}:${entityId}:${relationship}`, workspace, entityType, entityId, entityLabel, relationship, category, state });
  };
  for (const character of input.characters || []) {
    const push = (relationship, category, asset) => {
      const state = slotStateFromAsset(asset ? { file: asset.file || asset.activeFile, approvalCurrent: asset.approvalCurrent, activeVersion: asset.activeVersion } : null);
      if (state === "approved") return;
      items.push({
        id: `${character.id}:${relationship}`,
        workspace: "characters",
        entityType: "character",
        entityId: character.id,
        entityLabel: character.name,
        relationship,
        category,
        state
      });
    };
    if (!character.sheets?.length) push("character.primaryAppearance", "character", character.sheets?.[0] || null);
    if (!character.wardrobe?.length) push("character.wardrobe", "wardrobe", character.wardrobe?.[0] || null);
    if (!character.voices?.length) push("character.voice", "voice", null);
    else {
      const voice = character.voices[0];
      const file = voice.file || voice.activeFile;
      if (!file || voice.approvalCurrent === false) push("character.voice", "voice", voice);
    }
  }
  for (const cue of input.soundCues || []) {
    pushHole("sound", "segment", String(cue.cueId || cue.id), String(cue.speaker || cue.cueId || "cue"), "segment.dialogueAudio", "dialogue", cue.asset || cue);
  }
  for (const guide of input.ltxGuides || []) {
    pushHole("ltx", "guide", `${guide.id}:first`, String(guide.label || guide.id), "ltx.temporalGuide.first", "guide-frame", guide.first);
    if (!guide.last) pushHole("ltx", "guide", `${guide.id}:last`, String(guide.label || guide.id), "ltx.temporalGuide.last", "guide-frame", guide.last);
  }
  for (const slot of input.sequenceSlots || []) {
    pushHole("sequence", "sequence", slot.id, String(slot.label || slot.id), "sequence.media", "video", slot);
  }
  if (input.masterScore !== undefined) {
    pushHole("master", "master", "master", "Master", "master.score", "music", input.masterScore);
  }
  for (const blocker of input.exportBlockers || []) {
    pushHole("export", "export-blocker", blocker.id, String(blocker.label || blocker.id), String(blocker.relationship || "export.blocker"), "video", blocker);
  }
  for (const asset of input.libraryAssets || []) {
    pushHole("library", "library", asset.id, String(asset.name || asset.id), "library.asset", "atmosphere", asset);
  }
  for (const job of input.comfyJobs || []) {
    const status = String(job.status || "").toLowerCase();
    if (status === "error" || status === "failed" || status === "missing") {
      items.push({ id: `comfy:${job.id}`, workspace: "comfy", entityType: "sequence", entityId: job.id, entityLabel: String(job.label || job.id), relationship: "comfy.job", category: "atmosphere", state: "broken" });
    }
  }
  const counts = {};
  for (const key of ["characters", "storyboard", "sound", "ltx", "sequence", "master", "export", "library", "comfy"]) counts[key] = 0;
  for (const item of items) counts[item.workspace] = (counts[item.workspace] || 0) + 1;
  counts.total = items.length;
  return { items, counts };
}

export function withCharacterDependency(existing, characterId) {
  const list = Array.isArray(existing) ? existing.map(String) : [];
  if (characterId && !list.includes(characterId)) list.push(characterId);
  return list;
}

export function withoutCharacterDependency(existing, characterId) {
  return (Array.isArray(existing) ? existing : []).map(String).filter((id) => id !== characterId);
}
