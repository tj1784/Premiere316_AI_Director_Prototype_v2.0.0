export const LTX_DIRECTOR_ENDPOINT = "http://127.0.0.1:8190";

export type DirectorReviewInput = {
  pictureId: string;
  sceneId: string;
  renderSlot?: string;
  workflowJson: string;
};

export type DirectorOpenResult = {
  ok: true;
  workflowOpened: true;
  sceneId: string;
} | { ok: false; error: string };

export type DirectorReviewResult = {
  ok: true;
  reviewId: string;
  workflowSha256: string;
  nodeCount: number;
  issues: string[];
  runtimeAvailable: boolean;
  endpoint: string;
} | { ok: false; error: string };

export type DirectorRunResult = {
  ok: true;
  reviewId: string;
  promptId: string;
  workflowSha256: string;
  endpoint: string;
  workflowOpened: boolean;
  warning?: string;
} | { ok: false; error: string; uncertain?: boolean; promptId?: string };

export type DirectorJobStatusResult = {
  ok: true;
  promptId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";
  message: string;
  progress?: { nodeId: string | null; nodeType: string | null; stage: string | null; value: number | null; max: number | null; lastUpdated: number | null; connection: string };
  elapsedSeconds?: number;
  outputs: Array<{ filename: string; url: string; type: string }>;
} | { ok: false; error: string };
