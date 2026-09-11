import type { Picture, Shot } from "../studio/types.ts";
import { hydrateVideoWorkspace } from "./video-types.ts";
import { visualDirectionText } from "../studio/visual-direction.ts";
import { approvedAssetMedia } from "./asset-canonical-reference.ts";
import { isVisualAsset } from "../studio/asset-prompt-context.ts";
import { dialogueFramingDirection } from "../studio/dialogue-framing.ts";

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
  /** Canonical image revisions used when these frame prompts were prepared. */
  assetReferenceVersions?: Record<string, string>;
  /** Explicit user direction permits these imported references without changing asset approvals. */
  referenceAuthorization?: { source: "user"; packageId: string };
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
  const pairs = picture.shots.map((shot) => {
    const pair = base.pairs.find((item) => item.shotId === shot.id);
    if (!pair) return seedPair(picture, shot);
    // Refresh untouched planning placeholders as canon becomes available. Saved
    // prompt versions and explicitly waived/imported frame choices remain intact.
    if (!pair.waived && !pair.firstPromptVersionId && !pair.lastPromptVersionId && !pair.firstApprovedId && !pair.lastApprovedId) return seedPair(picture, shot);
    const directed = pair.referenceAuthorization?.source === "user" && pair.referenceAuthorization.packageId === picture.frameBundle?.packageId && picture.frameBundle?.approvalBypass.source === "user" && picture.frameBundle.importedShotIds.includes(shot.id);
    const validRefs = directed
      ? (picture.production?.assets ?? []).filter((asset) => isVisualAsset(asset) && !asset.tombstone && !asset.stale).map((asset) => asset.id)
      : approvedVisualAssetIds(picture, shot.sceneId);
    if (!pair.waived && pair.assetRefIds.some((id) => !validRefs.includes(id))) return { ...pair, status: "STALE" as const, staleReasons: [...new Set([...pair.staleReasons, "A referenced canonical asset is missing, changed, or belongs to another scene."])] };
    const currentVersions = directed ? directedReferenceVersions(picture, pair.assetRefIds) : canonicalReferenceVersions(picture, pair.assetRefIds);
    if (!pair.waived && pair.assetReferenceVersions && pair.assetRefIds.some((id) => pair.assetReferenceVersions![id] !== currentVersions[id])) return { ...pair, assetReferenceVersions: currentVersions, status: "STALE" as const, staleReasons: [...new Set([...pair.staleReasons, "A canonical image revision changed. Review frame prompts and re-approve first/last frames."])] };
    return pair;
  });
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
  const refs = approvedVisualAssetIds(picture, shot.sceneId);
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
    assetReferenceVersions: canonicalReferenceVersions(picture, refs),
    waived: false,
  };
}

function canonicalReferenceVersions(picture: Picture, ids: string[]): Record<string, string> {
  return Object.fromEntries(ids.flatMap((id) => {
    const asset = picture.production?.assets.find((item) => item.id === id);
    const media = asset ? approvedAssetMedia(asset) : null;
    return media ? [[id, `${media.id}|${media.specVersionId ?? asset?.approvedSpecVersionId ?? ""}|${media.mediaSha256 ?? media.mediaUri}`]] : [];
  }));
}

/** Record the actual chosen/reference media without asserting that its asset was approved. */
export function directedReferenceVersions(picture: Picture, ids: string[]): Record<string, string> {
  return Object.fromEntries(ids.flatMap((id) => {
    const asset = picture.production?.assets.find((item) => item.id === id);
    if (!asset || asset.tombstone || asset.stale) return [];
    const selected = approvedAssetMedia(asset) ?? asset.iterations.find((item) => item.status !== "REJECTED" && item.mediaUri?.trim());
    if (selected) return [[id, `${selected.id}|${selected.specVersionId ?? asset.approvedSpecVersionId ?? ""}|${selected.mediaSha256 ?? selected.mediaUri}`]];
    const reference = asset.references.find((item) => item.preferred && item.uri?.trim()) ?? asset.references.find((item) => item.uri?.trim());
    return reference ? [[id, `reference:${reference.id}|${reference.uri}`]] : [];
  }));
}

export function approvedVisualAssetIds(picture: Picture, sceneId?: string): string[] {
  const fromProduction = (picture.production?.assets ?? [])
    .filter((asset) => isVisualAsset(asset) && (!sceneId || asset.requiredSceneIds.includes(sceneId)) && approvedAssetMedia(asset))
    .map((asset) => asset.id);
  return fromProduction;
}

export function requiredVisualAssetCount(picture: Picture): { required: number; approved: number } {
  const assets = (picture.production?.assets ?? []).filter(isVisualAsset);
  if (assets.length) {
    const approved = assets.filter((asset) => approvedAssetMedia(asset)).length;
    return { required: assets.length, approved };
  }
  const required = picture.characters.length + picture.locations.length;
  return { required, approved: 0 };
}

export function generateGateReadiness(picture: Picture): GateReadiness[] {
  const gates = hydrateGenerateGates(picture.generateGates, picture);
  const assets = requiredVisualAssetCount(picture);
  const frameImportAuthorized = picture.frameBundle?.approvalBypass.source === "user" && picture.frameBundle.approvalBypass.scope === "first-last-frame-assets";
  const assetStatus = assets.required === 0 || assets.approved >= assets.required || frameImportAuthorized ? "READY" : assets.approved > 0 ? "PARTIAL" : "LOCKED";
  const pairsReady = gates.pairs.filter((pair) => pair.waived || approvedKeyframePair(gates, pair)).length;
  const keyframeStatus = assetStatus !== "READY" ? "LOCKED" : pairsReady === gates.pairs.length && gates.pairs.length > 0 ? "READY" : pairsReady > 0 ? "PARTIAL" : "LOCKED";
  const video = hydrateVideoWorkspace(picture.video);
  const canonicalVideo = picture.shots.filter((shot) => video.takes.some((take) => take.shotId === shot.id && take.canonical)).length;
  const nativeUnlocked = gates.pairs.some((pair) => pair.waived || approvedKeyframePair(gates, pair));
  const videoStatus = canonicalVideo > 0 ? "READY" : nativeUnlocked ? "PARTIAL" : "LOCKED";
  return [
    { gate: "assets", status: assetStatus, approved: assets.approved, required: assets.required || assets.approved, reason: frameImportAuthorized ? "Asset approval pause waived by the user for this first/last-frame package." : assetStatus === "READY" ? "Visual assets approved or none required." : `${assets.approved}/${assets.required} visual assets approved.` },
    { gate: "keyframes", status: keyframeStatus, approved: pairsReady, required: gates.pairs.length, reason: assetStatus !== "READY" ? "First/Last locked until required visual assets are approved or waived." : `${pairsReady}/${gates.pairs.length} keyframe pairs approved or waived.` },
    { gate: "video", status: videoStatus, approved: canonicalVideo, required: picture.shots.length, reason: nativeUnlocked || canonicalVideo ? `${canonicalVideo} canonical video take(s). Native generate stays fail-closed; import remains allowed.` : "Video generate locked until a keyframe pair is approved or waived. Import remains allowed." },
  ];
}

export function keyframeGateLocked(picture: Picture): boolean {
  return generateGateReadiness(picture)[0].status !== "READY";
}

export function nativeVideoLockedForShot(picture: Picture, shotId: string): boolean {
  const workspace = hydrateGenerateGates(picture.generateGates, picture);
  const pair = workspace.pairs.find((item) => item.shotId === shotId);
  if (!pair) return true;
  if (pair.waived) return false;
  return !approvedKeyframePair(workspace, pair);
}

function approvedKeyframePair(workspace: GenerateGateWorkspace, pair: KeyframePair): boolean {
  if (pair.status === "STALE") return false;
  return (["first", "last"] as const).every((kind) => {
    const id = kind === "first" ? pair.firstApprovedId : pair.lastApprovedId;
    return workspace.iterations.some((item) => item.id === id && item.shotId === pair.shotId && item.kind === kind && item.canonical && item.status === "APPROVED" && item.origin !== "fail-closed" && Boolean(item.mediaUri?.trim()) && /^[a-f0-9]{64}$/i.test(item.mediaSha256 ?? ""));
  });
}

export function compileKeyframePrompt(picture: Picture, shot: Shot, kind: KeyframeKind, assetRefIds: string[]): string {
  const allowed = approvedVisualAssetIds(picture, shot.sceneId);
  const refs = [...new Set(assetRefIds)].filter((id) => allowed.includes(id)).map((id) => {
    const asset = picture.production!.assets.find((item) => item.id === id)!;
    const media = approvedAssetMedia(asset)!;
    return `${asset.name} [asset ${id}; iteration ${media.id}${media.specVersionId ?? asset.approvedSpecVersionId ? `; spec ${media.specVersionId ?? asset.approvedSpecVersionId}` : ""}]`;
  }).join(", ") || "pending canonical media";
  const beat = kind === "first" ? "opening frame / continuity IN" : "closing frame / continuity OUT";
  const direction = picture.intake.visualDirection;
  const style = direction?.guide && direction.analyzedBoardId === direction.boardId ? visualDirectionText(direction) : "";
  return `${shot.type} ${beat}. ${shot.description}. ${shot.camera} ${shot.lens}, ${shot.cameraMove}. ${dialogueFramingDirection(shot)} Emotion: ${shot.emotion}. Approved refs: ${refs}. ${picture.tone}.${style ? `\n\n${style}` : ""}`;
}

export function compileVideoPromptFromKeyframes(picture: Picture, shot: Shot, pair: KeyframePair): PromptVersion {
  const workspace = hydrateGenerateGates(picture.generateGates, picture);
  const currentPair = workspace.pairs.find((item) => item.shotId === pair.shotId);
  if (!currentPair || currentPair.shotId !== shot.id || (!currentPair.waived && !approvedKeyframePair(workspace, currentPair))) throw new Error("Approve current first and last frames before writing the video prompt, or explicitly waive the pair for an imported video.");
  pair = currentPair;
  const now = Date.now();
  return {
    id: `vp:${shot.id}:${now}`,
    gate: "video",
    shotId: shot.id,
    assetId: null,
    kind: "video",
    text: `${pair.waived ? "Explicit frame-pair waiver for imported video; no frame approval is implied." : `Animate from approved first frame ${pair.firstApprovedId} to approved last frame ${pair.lastApprovedId}.`} Action: ${shot.description}. Camera: ${shot.cameraMove}. ${dialogueFramingDirection(shot)} Hold identity of ${pair.assetRefIds.join(", ") || "the established scene subjects"}. Duration ${shot.durationSec}s.`,
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
      ? { ...pair, firstPrompt: input.kind === "first" ? input.text : pair.firstPrompt, lastPrompt: input.kind === "last" ? input.text : pair.lastPrompt, firstPromptVersionId: input.kind === "first" ? prompt.id : pair.firstPromptVersionId, lastPromptVersionId: input.kind === "last" ? prompt.id : pair.lastPromptVersionId, assetRefIds: [...new Set(input.assetRefIds)], status: pair.status === "APPROVED" ? "STALE" : pair.status, staleReasons: pair.staleReasons }
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
  if (!iteration.mediaUri?.trim() || !/^[a-f0-9]{64}$/i.test(iteration.mediaSha256 ?? "")) throw new Error("Canonical keyframe requires durable media.");
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
