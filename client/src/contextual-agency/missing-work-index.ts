import { slotStateFromAsset, type AssetCategory, type RequirementSlotState } from "./types";

export type MissingWorkItem = {
  id: string;
  workspace: "characters" | "storyboard" | "sound" | "ltx" | "sequence" | "master" | "export" | "library" | "comfy";
  entityType: string;
  entityId: string;
  entityLabel: string;
  relationship: string;
  category: AssetCategory;
  state: RequirementSlotState;
};

export type MissingWorkIndex = {
  items: MissingWorkItem[];
  counts: Record<string, number>;
};

function countBy(items: MissingWorkItem[]) {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.workspace] = (counts[item.workspace] || 0) + 1;
  counts.total = items.length;
  return counts;
}

function hole(asset: any): RequirementSlotState {
  return slotStateFromAsset(asset ? { file: asset.file || asset.activeFile, approvalCurrent: asset.approvalCurrent, activeVersion: asset.activeVersion } : null);
}

export function buildMissingWorkIndex(input: {
  characters?: Array<{
    id: string;
    name: string;
    sheets?: any[];
    wardrobe?: any[];
    voices?: any[];
  }>;
  soundCues?: Array<{ cueId?: string; id?: string; speaker?: string; file?: string; asset?: any; approvalCurrent?: boolean }>;
  ltxGuides?: Array<{ id: string; label?: string; first?: any; last?: any }>;
  sequenceSlots?: Array<{ id: string; label?: string; file?: string; approvalCurrent?: boolean }>;
  masterScore?: { file?: string; approvalCurrent?: boolean; activeVersion?: number } | null;
  exportBlockers?: Array<{ id: string; label?: string; relationship?: string; file?: string; approvalCurrent?: boolean }>;
  libraryAssets?: Array<{ id: string; name?: string; file?: string; approvalCurrent?: boolean; activeVersion?: number }>;
  comfyJobs?: Array<{ id: string; label?: string; status?: string }>;
} = {}): MissingWorkIndex {
  const items: MissingWorkItem[] = [];
  for (const character of input.characters || []) {
    const sheet = character.sheets?.[0] || null;
    const wardrobe = character.wardrobe?.[0] || null;
    const voice = character.voices?.[0] || null;
    const push = (relationship: string, category: AssetCategory, asset: any) => {
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
    if (!character.sheets?.length) push("character.primaryAppearance", "character", sheet);
    if (!character.wardrobe?.length) push("character.wardrobe", "wardrobe", wardrobe);
    if (!character.voices?.length) push("character.voice", "voice", voice);
    else {
      const file = voice.file || voice.activeFile;
      if (!file || voice.approvalCurrent === false) push("character.voice", "voice", voice);
    }
  }
  const pushHole = (workspace: MissingWorkItem["workspace"], entityType: string, entityId: string, entityLabel: string, relationship: string, category: AssetCategory, asset: any) => {
    const state = hole(asset);
    if (state === "approved") return;
    items.push({ id: `${workspace}:${entityId}:${relationship}`, workspace, entityType, entityId, entityLabel, relationship, category, state });
  };
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
  const counts = countBy(items);
  for (const key of ["characters", "storyboard", "sound", "ltx", "sequence", "master", "export", "library", "comfy"]) {
    if (counts[key] == null) counts[key] = 0;
  }
  return { items, counts };
}
