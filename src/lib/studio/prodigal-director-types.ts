import type { BundledFrameMedia } from "./prodigal-frame-types.ts";

export type ProdigalDirectorFile = { mediaUri: string; sha256: string; bytes: number };
export type ProdigalDirectorSegment = {
  shotId: string;
  segmentId: string;
  startFrame: number;
  durationFrames: number;
  durationSeconds: number;
  prompt: string;
  sourceImagePath: string;
  startImage: BundledFrameMedia;
};
export type ProdigalDirectorScene = {
  replacement?: {
    revision: string;
    screenplayMarkdown: string;
    shotTitles: string[];
    settings: { width: number; height: number; baseSteps: number; refineSteps: number; outputPrefix: string };
  };
  sceneId: string;
  title: string;
  workflow: ProdigalDirectorFile;
  frameRate: 24;
  storyDurationSeconds: number;
  generationDurationSeconds: number;
  globalPrompt: string;
  segments: ProdigalDirectorSegment[];
};
export type ProdigalDirectorManifest = {
  schemaVersion: 1;
  packageId: string;
  pictureId: string;
  screenplayVersionId: string;
  revision: string;
  createdAt: number;
  sourceArchive: { name: string; sha256: string };
  storyDurationSeconds: number;
  generationDurationSeconds: number;
  creditsSeconds: number;
  storyShotCount: number;
  generationSegmentCount: number;
  documents: Array<ProdigalDirectorFile & { name: string }>;
  scenes: ProdigalDirectorScene[];
  reusedShots: Array<{
    shotId: string;
    sceneId: string;
    sourceShotId: string;
    durationSeconds: number;
    sourceIntervalSeconds: null;
    dialogue: "muted";
    action: string;
  }>;
};

/** Import bookkeeping survives reload and does not reapply edits or resurrect removals. */
export type ProdigalDirectorImportState = {
  packageId: string;
  revision: string;
  importedShotIds: string[];
  skippedShotIds: string[];
  importedPromptIds: string[];
  importedIterationIds: string[];
};
