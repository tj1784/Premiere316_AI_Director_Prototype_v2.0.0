import type { Picture, Shot } from "../studio/types.ts";
import { hydrateVideoWorkspace } from "./video-types.ts";

export type GenerateGateId = "assets" | "keyframes" | "video";
export type GateItemStatus =
  | "NOT_STARTED"
  | "PROMPT_READY"
  | "GENERATING"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "WAIVED"
  | "STALE"
  | "BLOCKED"
  | "FAILED";

export type KeyframeKind = "first" | "last";

export type PromptVersion = {
  id: string;
  gate: GenerateGateId;
  shotId: string | null;
  assetId: string | null;
  kind: "asset" | "first" | "last" | "video";
  text: string;
  createdAt: number;
  assetRefIds: string[];
  firstFrameId: string | null;
  lastFrameId: string | null;
};

export type KeyframeIteration = {
  id: string;
  shotId: string;
  kind: KeyframeKind;
  origin: "imported" | "generated" | "fail-closed";
  promptVersionId: string | null;
  mediaUri: string | null;
  mediaSha256: string | null;
  status: GateItemStatus;
  canonical: boolean;
  createdAt: number;
  failClosedReason: string | null;
};

export type KeyframePair = {
  shotId: string;
  firstPrompt: string;
  lastPrompt: string;
  firstPromptVersionId: string | null;
  lastPromptVersionId: string | null;
  firstApprovedId: string | null;
  lastApprovedId: string | null;
  status: GateItemStatus;
  staleReasons: string[];
  assetRefIds: string[];
  waived: boolean;
};

export type GenerateGateWorkspace = {
  schemaVersion: 1;
  activeGate: GenerateGateId;
  filterId: string | null;
  pairs: KeyframePair[];
  iterations: KeyframeIteration[];
  prompts: PromptVersion[];
};

export type GateReadiness = {
  gate: GenerateGateId;
  status: "READY" | "LOCKED" | "BLOCKED" | "PARTIAL";
  approved: number;
  required: number;
  reason: string;
};

export function emptyGenerateGates(): GenerateGateWorkspace {
  return { schemaVersion: 1, activeGate: "assets", filterId: null, pairs: [], iterations: [], prompts: [] };
}

export function hydrateGenerateGates(state: GenerateGateWorkspace | null | undefined, picture: Picture): GenerateGateWorkspace {
  const base = !state || state.schemaVersion !== 1 ? emptyGenerateGates() : state;
  const pairs = picture.shots.map((shot) => base.pairs.find((pair) => pair.shotId === shot.id) ?? seedPair(picture, shot));
  return {
    schemaVersion: 1,
    activeGate: base.activeGate,
    filterId: base.filterId,
    pairs,
    iterations: Array.isArray(base.iterations) ? base.iterations : [],
    prompts: Array.isArray(base.prompts) ? base.prompts : [],
  };
}

function seedPair(picture: Picture, shot: Shot): KeyframePair {
  const refs = approvedVisualAssetIds(picture);
  return {
    shotId: shot.id,
    firstPrompt: compileKeyframePrompt(picture, shot, "first", refs),
    lastPrompt: compileKeyframePrompt(picture, shot, "last", refs),
    firstPromptVersionId: null,
    lastPromptVersionId: null,
    firstApprovedId: null,
    lastApprovedId: null,
    status: "PROMPT_READY",
    staleReasons: [],
    assetRefIds: refs,
    waived: false,
  };
}

export function approvedVisualAssetIds(picture: Picture): string[] {
  const fromProduction = (picture.production?.assets ?? [])
    .filter((asset) => !asset.tombstone && (asset.canonicalApproved || Boolean(asset.approvedIterationId) || asset.readiness === "APPROVED" || asset.readiness === "APPROVED_PREPARED" || asset.readiness === "READY_TO_GENERATE"))
    .map((asset) => asset.id);
  if (fromProduction.length) return fromProduction;
  return [...picture.characters.map((item) => item.id), ...picture.locations.map((item) => item.id)];
}

export function requiredVisualAssetCount(picture: Picture): { required: number; approved: number } {
  const assets = (picture.production?.assets ?? []).filter((asset) => !asset.tombstone);
  if (assets.length) {
    const approved = assets.filter((asset) => asset.canonicalApproved || Boolean(asset.approvedIterationId) || asset.readiness === "APPROVED" || asset.readiness === "APPROVED_PREPARED" || asset.readiness === "READY_TO_GENERATE").length;
    return { required: assets.length, approved };
  }
  const required = picture.characters.length + picture.locations.length;
  return { required, approved: required };
}

export function generateGateReadiness(picture: Picture): GateReadiness[] {
  const gates = hydrateGenerateGates(picture.generateGates, picture);
  const assets = requiredVisualAssetCount(picture);
  const assetStatus = assets.required === 0 || assets.approved >= assets.required ? "READY" : assets.approved > 0 ? "PARTIAL" : "LOCKED";
  const pairsReady = gates.pairs.filter((pair) => pair.waived || (pair.firstApprovedId && pair.lastApprovedId && pair.status !== "STALE")).length;
  const keyframeStatus = assetStatus !== "READY" ? "LOCKED" : pairsReady === gates.pairs.length && gates.pairs.length > 0 ? "READY" : pairsReady > 0 ? "PARTIAL" : "LOCKED";
  const video = hydrateVideoWorkspace(picture.video);
  const canonicalVideo = picture.shots.filter((shot) => video.takes.some((take) => take.shotId === shot.id && take.canonical)).length;
  const nativeUnlocked = gates.pairs.some((pair) => pair.waived || (pair.firstApprovedId && pair.lastApprovedId));
  const videoStatus = canonicalVideo > 0 ? "READY" : nativeUnlocked ? "PARTIAL" : "LOCKED";
  return [
    { gate: "assets", status: assetStatus, approved: assets.approved, required: assets.required || assets.approved, reason: assetStatus === "READY" ? "Visual assets approved or none required." : `${assets.approved}/${assets.required} visual assets approved.` },
    { gate: "keyframes", status: keyframeStatus, approved: pairsReady, required: gates.pairs.length, reason: assetStatus !== "READY" ? "First/Last locked until required visual assets are approved or waived." : `${pairsReady}/${gates.pairs.length} keyframe pairs approved or waived.` },
    { gate: "video", status: videoStatus, approved: canonicalVideo, required: picture.shots.length, reason: nativeUnlocked || canonicalVideo ? `${canonicalVideo} canonical video take(s). Native generate stays fail-closed; import remains allowed.` : "Video generate locked until a keyframe pair is approved or waived. Import remains allowed." },
  ];
}

export function keyframeGateLocked(picture: Picture): boolean {
  return generateGateReadiness(picture)[0].status !== "READY";
}

export function nativeVideoLockedForShot(picture: Picture, shotId: string): boolean {
  const pair = hydrateGenerateGates(picture.generateGates, picture).pairs.find((item) => item.shotId === shotId);
  if (!pair) return true;
  if (pair.waived) return false;
  return !(pair.firstApprovedId && pair.lastApprovedId) || pair.status === "STALE";
}

export function compileKeyframePrompt(picture: Picture, shot: Shot, kind: KeyframeKind, assetRefIds: string[]): string {
  const refs = assetRefIds.join(", ") || "no approved asset refs";
  const beat = kind === "first" ? "opening frame / continuity IN" : "closing frame / continuity OUT";
  return `${shot.type} ${beat}. ${shot.description}. ${shot.camera} ${shot.lens}, ${shot.cameraMove}. Emotion: ${shot.emotion}. Approved refs: ${refs}. ${picture.tone}.`;
}

export function compileVideoPromptFromKeyframes(picture: Picture, shot: Shot, pair: KeyframePair): PromptVersion {
  const now = Date.now();
  return {
    id: `vp:${shot.id}:${now}`,
    gate: "video",
    shotId: shot.id,
    assetId: null,
    kind: "video",
    text: `Animate from approved first frame ${pair.firstApprovedId ?? "missing"} to last frame ${pair.lastApprovedId ?? "missing"}. Action: ${shot.description}. Camera: ${shot.cameraMove}. Hold identity of ${pair.assetRefIds.join(", ") || "approved refs"}. Duration ${shot.durationSec}s.`,
    createdAt: now,
    assetRefIds: pair.assetRefIds,
    firstFrameId: pair.firstApprovedId,
    lastFrameId: pair.lastApprovedId,
  };
}

export function savePromptVersion(workspace: GenerateGateWorkspace, input: Omit<PromptVersion, "id" | "createdAt"> & { now?: number }): GenerateGateWorkspace {
  const now = input.now ?? Date.now();
  const prompt: PromptVersion = { ...input, id: `prompt:${input.kind}:${input.shotId ?? input.assetId}:${now}`, createdAt: now };
  let pairs = workspace.pairs;
  if (input.kind === "first" || input.kind === "last") {
    pairs = pairs.map((pair) => pair.shotId === input.shotId
      ? { ...pair, firstPrompt: input.kind === "first" ? input.text : pair.firstPrompt, lastPrompt: input.kind === "last" ? input.text : pair.lastPrompt, firstPromptVersionId: input.kind === "first" ? prompt.id : pair.firstPromptVersionId, lastPromptVersionId: input.kind === "last" ? prompt.id : pair.lastPromptVersionId, status: pair.status === "APPROVED" ? "STALE" : pair.status, staleReasons: input.kind === "video" ? pair.staleReasons : pair.staleReasons }
      : pair);
  }
  return { ...workspace, prompts: [...workspace.prompts, prompt], pairs };
}

export function recordImportedKeyframe(workspace: GenerateGateWorkspace, input: { shotId: string; kind: KeyframeKind; mediaUri: string; mediaSha256: string; now?: number }): GenerateGateWorkspace {
  if (!/^[a-f0-9]{64}$/.test(input.mediaSha256)) throw new Error("Imported keyframe requires SHA-256.");
  const now = input.now ?? Date.now();
  const iteration: KeyframeIteration = {
    id: `kf:${input.shotId}:${input.kind}:${now}`,
    shotId: input.shotId,
    kind: input.kind,
    origin: "imported",
    promptVersionId: null,
    mediaUri: input.mediaUri,
    mediaSha256: input.mediaSha256,
    status: "NEEDS_REVIEW",
    canonical: false,
    createdAt: now,
    failClosedReason: null,
  };
  return { ...workspace, iterations: [...workspace.iterations, iteration] };
}

export function failClosedKeyframe(workspace: GenerateGateWorkspace, shotId: string, kind: KeyframeKind, reason: string, now = Date.now()): GenerateGateWorkspace {
  const iteration: KeyframeIteration = {
    id: `kf:${shotId}:${kind}:${now}`,
    shotId,
    kind,
    origin: "fail-closed",
    promptVersionId: null,
    mediaUri: null,
    mediaSha256: null,
    status: "FAILED",
    canonical: false,
    createdAt: now,
    failClosedReason: reason,
  };
  return { ...workspace, iterations: [...workspace.iterations, iteration] };
}

export function approveKeyframeIteration(workspace: GenerateGateWorkspace, iterationId: string, now = Date.now()): GenerateGateWorkspace {
  const iteration = workspace.iterations.find((item) => item.id === iterationId);
  if (!iteration) throw new Error("Keyframe iteration not found.");
  if (iteration.origin === "fail-closed") throw new Error("Fail-closed keyframes cannot become canonical.");
  if (!iteration.mediaSha256) throw new Error("Canonical keyframe requires durable media.");
  const iterations = workspace.iterations.map((item) => item.shotId === iteration.shotId && item.kind === iteration.kind
    ? { ...item, canonical: item.id === iterationId, status: item.id === iterationId ? "APPROVED" as const : item.canonical ? "NEEDS_REVIEW" as const : item.status }
    : item);
  const pairs = workspace.pairs.map((pair) => {
    if (pair.shotId !== iteration.shotId) return pair;
    const firstApprovedId = iteration.kind === "first" ? iterationId : pair.firstApprovedId;
    const lastApprovedId = iteration.kind === "last" ? iterationId : pair.lastApprovedId;
    const ready = Boolean(pair.waived || (firstApprovedId && lastApprovedId));
    return { ...pair, firstApprovedId, lastApprovedId, status: ready ? "APPROVED" : "NEEDS_REVIEW" as GateItemStatus, staleReasons: [] };
  });
  return { ...workspace, iterations, pairs };
}

export function waiveKeyframePair(workspace: GenerateGateWorkspace, shotId: string, reason: string): GenerateGateWorkspace {
  return {
    ...workspace,
    pairs: workspace.pairs.map((pair) => pair.shotId === shotId ? { ...pair, waived: true, status: "WAIVED", staleReasons: reason ? [reason] : [] } : pair),
  };
}

export function staleAfterAssetChange(workspace: GenerateGateWorkspace, assetId: string): GenerateGateWorkspace {
  const pairs = workspace.pairs.map((pair) => pair.assetRefIds.includes(assetId)
    ? { ...pair, status: "STALE" as const, staleReasons: [`Asset ${assetId} changed. Re-approve first/last frames.`] }
    : pair);
  return { ...workspace, pairs };
}

export function staleAfterKeyframeChange(workspace: GenerateGateWorkspace, shotId: string): GenerateGateWorkspace {
  return {
    ...workspace,
    prompts: workspace.prompts.map((prompt) => prompt.shotId === shotId && prompt.kind === "video"
      ? { ...prompt, text: `${prompt.text}\n[STALE: keyframe changed]` }
      : prompt),
    pairs: workspace.pairs.map((pair) => pair.shotId === shotId ? { ...pair, status: pair.waived ? pair.status : "STALE", staleReasons: pair.waived ? pair.staleReasons : ["Keyframe changed. Video prompt/takes are stale."] } : pair),
  };
}

export function staleAfterVideoPromptChange(workspace: GenerateGateWorkspace, shotId: string): GenerateGateWorkspace {
  return {
    ...workspace,
    pairs: workspace.pairs.map((pair) => pair.shotId === shotId ? { ...pair, staleReasons: [...pair.staleReasons.filter((item) => !item.startsWith("Video prompt")), "Video prompt changed. Existing takes may be stale."] } : pair),
  };
}

export function cohesionChain(picture: Picture, shotId: string): Record<string, string | string[] | null> {
  const gates = hydrateGenerateGates(picture.generateGates, picture);
  const pair = gates.pairs.find((item) => item.shotId === shotId) ?? null;
  const video = hydrateVideoWorkspace(picture.video).takes.find((take) => take.shotId === shotId && take.canonical) ?? null;
  const prompt = [...gates.prompts].reverse().find((item) => item.shotId === shotId && item.kind === "video") ?? null;
  return {
    shotId,
    videoTakeId: video?.id ?? null,
    videoPromptVersionId: prompt?.id ?? null,
    firstFrameId: pair?.firstApprovedId ?? null,
    lastFrameId: pair?.lastApprovedId ?? null,
    assetRefs: pair?.assetRefIds ?? [],
    origin: video?.origin ?? null,
    engine: video?.engineId ?? null,
    status: video?.status ?? pair?.status ?? "NOT_STARTED",
  };
}
