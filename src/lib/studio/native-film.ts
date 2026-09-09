export type NativeFilmDraft = { visualContinuity: string; prompts: Record<string, string>; imagePrompts?: Record<string, string>; writer?: { modelId: string; generatedAt: number; rawResponse: string }; promptEditedAt?: number; jobId?: string };
export type NativeFilmRequest = { pictureId: string; title: string; visualContinuity: string; writer?: NativeFilmDraft["writer"]; promptEditedAt?: number; shots: Array<{ id: string; seconds: number; prompt: string }> };
export type NativeFilmStatus = {
  ok: boolean; error?: string; jobId: string; stage: string; running: boolean;
  shot?: string; step?: number; steps?: number; targetSeconds?: number; totalShots?: number; playableShots?: number;
  clips: Array<{ id: string; sourceShotId: string; seconds: number; prompt: string; sha256: string; mediaUri: string }>;
  movieUri: string | null;
};
