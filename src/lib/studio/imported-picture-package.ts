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
};

export type ImportedSceneTiming = {
  id: string;
  slugline: string;
  duration_seconds: number;
  story_time: string;
  title: string;
  action: string;
  continuity: string;
};

export type ImportedContinuityRule = {
  id: string;
  asset: string;
  scenes: string[];
  state: string;
  transition: string;
  constant: string;
};

export type ImportedPictureSource = {
  fountain: string;
  researchNotes: string;
  packageReadme: string;
  assets: ImportedVisualAsset[];
  scenes: ImportedSceneTiming[];
  sceneAssetLinks: Array<{ scene_id: string; asset_id: string; use: string }>;
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
