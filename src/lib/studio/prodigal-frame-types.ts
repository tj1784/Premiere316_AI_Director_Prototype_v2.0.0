export type BundledFrameMedia = {
  mediaUri: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
};

export type ProdigalFrameShot = {
  [key: string]: unknown;
  id: string;
  scene_id: string;
  title: string;
  duration_seconds: number;
  lens_mm: number;
  camera_motion: string;
  first_frame: string;
  last_frame: string;
  visible_character_asset_ids: string[];
  visible_animal_asset_ids?: string[];
  location_asset_id: string;
  reference_filenames: string[];
  continuity_locks: string[];
  dialogue_coverage: string;
  dialogue_framing?: "close_up" | "no_dialogue" | "artistic_exception";
  dialogue_framing_exception?: string;
  dialogue_lines?: Array<{ character: string; text: string }>;
  reuse_from_shot?: string;
  source_shot_id?: string;
  frames: { first?: BundledFrameMedia; last?: BundledFrameMedia };
};

export type ProdigalFrameManifest = {
  schemaVersion: 1;
  packageId: string;
  pictureId: string;
  revision: string;
  sourceCommit: string;
  screenplayVersionId: string;
  aspectRatio: "2.39:1";
  frameRate: 24;
  storyDurationSeconds: number;
  creditsSeconds: 30;
  createdAt: number;
  authorization: { source: "user"; scope: "direct-first-last-frame-import"; note: string };
  assetCorrections?: Array<{ assetId: string; reason: string; media: BundledFrameMedia }>;
  shots: ProdigalFrameShot[];
};

/** Retain import decisions so reloads never resurrect deleted shots or frames. */
export type ProdigalFrameImportState = {
  packageId: string;
  revision: string;
  importedShotIds: string[];
  skippedShotIds: string[];
  importedIterationIds: string[];
  importedAssetIterationIds?: string[];
  approvalBypass: { source: "user"; scope: "first-last-frame-assets"; note: string };
};
