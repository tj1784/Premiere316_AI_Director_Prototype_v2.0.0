export type ImportedWorkbookAssetRow = {
  assetId: string;
  category: string;
  assetName: string;
  canonicalParent: string;
  designRequirement: string;
  continuityState: string;
  sceneUses: string;
  requiredReference: string;
  approvalStatus: string;
  approvedAssetPath: string;
  sceneCount: number;
  generationPrompt: string;
};

export type ImportedWorkbookSceneRow = {
  sceneId: string;
  sceneTitle: string;
  setting: string;
  storyTime: string;
  seconds: number;
  duration: string;
  start: string;
  end: string;
  visibleAction: string;
  continuityFocus: string;
};

export type ImportedWorkbookSceneLinkRow = {
  sceneId: string;
  assetId: string;
  assetName: string;
  sceneSpecificUse: string;
};

export type ImportedWorkbookContinuityRow = {
  continuityId: string;
  assetOrFamily: string;
  sceneUses: string;
  requiredState: string;
  transitionOrReset: string;
  keepConstant: string;
};

/** Lossless source metadata for an imported screenplay and inventory package. */
export type ImportedVisualAsset = {
  id: string;
  category: string;
  name: string;
  parent: string;
  requirement: string;
  state: string;
  scenes: string[];
  reference: string;
  approval_status: string;
  approved_asset_path: string;
  scene_count?: number;
  generation_prompt?: string;
  workbook?: ImportedWorkbookAssetRow;
};

export type ImportedSceneTiming = {
  id: string;
  slugline: string;
  duration_seconds: number;
  start_seconds?: number;
  end_seconds?: number;
  duration_label?: string;
  story_time: string;
  title: string;
  action: string;
  continuity: string;
  workbook?: ImportedWorkbookSceneRow;
};

export type ImportedContinuityRule = {
  id: string;
  asset: string;
  scenes: string[];
  state: string;
  transition: string;
  constant: string;
  workbook?: ImportedWorkbookContinuityRow;
};

export type ImportedPictureSource = {
  fountain: string;
  researchNotes: string;
  packageReadme: string;
  assets: ImportedVisualAsset[];
  scenes: ImportedSceneTiming[];
  sceneAssetLinks: Array<{ scene_id: string; asset_id: string; asset_name?: string; use: string; workbook?: ImportedWorkbookSceneLinkRow }>;
  continuity: ImportedContinuityRule[];
  revision: string;
  sourceSha256: Record<string, string>;
};

export type ImportedPicturePackage = {
  schemaVersion: 1;
  packageId: string;
  revision: string;
  importedAt: number;
  provenance: string;
  screenplayAcceptance: string;
  researchStatus: "completed-source-import-pending-app-review";
  researchNotes: string;
  sourceAssets: ImportedVisualAsset[];
  timingPlan: ImportedSceneTiming[];
  sceneAssetLinks: ImportedPictureSource["sceneAssetLinks"];
  continuity: ImportedContinuityRule[];
  sourceSha256: Record<string, string>;
  resources: Array<{ label: string; fileName: string; href: string }>;
};
