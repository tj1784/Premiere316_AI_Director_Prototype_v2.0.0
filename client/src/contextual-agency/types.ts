import {
  MANUAL_ACTIONS as manualActionsJs,
  MODEL_ACTIONS as modelActionsJs,
  actionsForSlotState as actionsForSlotStateJs,
  slotStateFromAsset as slotStateFromAssetJs
} from "./agency.js";

export type AssetEntityType =
  | "character"
  | "scene"
  | "clip"
  | "segment"
  | "storyboard-frame"
  | "guide"
  | "timeline-item"
  | "score"
  | "master"
  | "export-blocker"
  | "library"
  | "sequence";

export type AssetCategory =
  | "character"
  | "wardrobe"
  | "location"
  | "artifact"
  | "extra"
  | "atmosphere"
  | "guide-frame"
  | "voice"
  | "dialogue"
  | "sound"
  | "music"
  | "video";

export type AssetActionName =
  | "generate"
  | "upload"
  | "create"
  | "choose"
  | "edit"
  | "replace"
  | "review"
  | "assign"
  | "attach"
  | "restore"
  | "unlink"
  | "versions";

export type RequirementSlotState = "missing" | "planned" | "unapproved" | "approved" | "broken";

export type AssetActionIntent = {
  sourceRoute: string;
  sourceEntity: {
    type: AssetEntityType;
    id: string;
    label: string;
  };
  requirement: {
    relationship: string;
    category: AssetCategory;
    assetId?: string;
    assetVersion?: number;
    expectedVariant?: string;
    expectedMediaType?: "image" | "audio" | "video" | "instruction";
  };
  initialAction?: AssetActionName;
  returnFocusId?: string;
  slotState?: RequirementSlotState;
  prefill?: { name?: string; prompt?: string; sampleText?: string; workflowId?: string; continuity?: string[]; continuityLocks?: string[]; cueLines?: string[] };
};

export const MANUAL_ACTIONS = manualActionsJs as AssetActionName[];
export const MODEL_ACTIONS = modelActionsJs as AssetActionName[];

export function actionsForSlotState(state: RequirementSlotState): AssetActionName[] {
  return actionsForSlotStateJs(state) as AssetActionName[];
}

export function slotStateFromAsset(asset: { file?: string | null; approvalCurrent?: boolean; activeVersion?: number } | null | undefined): RequirementSlotState {
  return slotStateFromAssetJs(asset) as RequirementSlotState;
}
