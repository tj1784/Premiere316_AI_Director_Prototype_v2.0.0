import { withCharacterDependency, withoutCharacterDependency } from "./agency.js";

export const STORYBOARD_ENTITIES = new Set(["storyboard-frame", "clip", "segment"]);

export function isVoiceCategory(category) {
  return category === "voice" || category === "dialogue";
}

export function isDialogueCategory(category) {
  return category === "dialogue";
}

export function qwenVoiceReady(health) {
  return Boolean(health?.capabilities?.qwenVoiceDesign || health?.qwenVoiceDesign);
}

export function qwenTtsReady(health) {
  return Boolean(health?.capabilities?.qwenTts || health?.providers?.qwenTts?.ready || health?.qwenTts);
}

export function generateBlockReason(intent, health) {
  if (isDialogueCategory(intent?.requirement?.category)) {
    return qwenTtsReady(health) ? "" : "Qwen TTS is offline. Upload, create, choose, and review stay available.";
  }
  if (intent?.requirement?.category === "voice") {
    return qwenVoiceReady(health) ? "" : "Qwen Voice Design is offline. Upload, create, choose, and review stay available.";
  }
  return health?.comfy ? "" : "ComfyUI is offline. Upload, create, choose, and review stay available.";
}

export function roleForCategory(category) {
  if (category === "character") return "identity";
  if (category === "wardrobe") return "wardrobe";
  if (category === "location") return "location";
  if (category === "artifact" || category === "graphic") return "prop";
  if (category === "extra") return "crowd";
  if (category === "atmosphere") return "atmosphere";
  return "identity";
}

export function sourceRoutePrefix(sourceRoute) {
  const route = String(sourceRoute || "");
  if (route.includes("/storyboard")) return "storyboard";
  if (route.includes("/ltx")) return "ltx";
  if (route.includes("/sequence")) return "sequence";
  if (route.includes("/sound")) return "sound";
  if (route.includes("/master")) return "master";
  if (route.includes("/export")) return "export";
  if (route.includes("/assets") || route.includes("/library")) return "library";
  return "";
}

export function isLastGuideRelationship(relationship) {
  const rel = String(relationship || "");
  return rel === "ltx.lastGuide" || rel === "ltx.temporalGuide.last" || rel.endsWith(".last");
}

export function isLtxDialogueCue(intent) {
  const route = String(intent?.sourceRoute || "");
  const fromLtx = route.includes("/ltx");
  const entity = intent?.sourceEntity?.type;
  const rel = String(intent?.requirement?.relationship || "");
  const category = intent?.requirement?.category;
  const media = intent?.requirement?.expectedMediaType;
  if (rel === "ltx.dialogueCue") return true;
  return Boolean(fromLtx && entity === "segment" && (category === "dialogue" || media === "audio"));
}

export function cueIdFromIntent(intent) {
  const variant = String(intent?.requirement?.expectedVariant || "").trim();
  if (variant) return variant;
  const focus = String(intent?.returnFocusId || "");
  const ltxFocus = focus.match(/^ltx-cue-(.+)$/);
  if (ltxFocus) return ltxFocus[1];
  const match = focus.match(/^cue-(?:link-)?(.+)$/);
  if (match) return match[1];
  const label = String(intent?.sourceEntity?.label || "").split("·")[0].trim();
  if (label) return label;
  return String(intent?.sourceEntity?.id || "");
}

export function restoreReturnFocus(intent) {
  const id = String(intent?.returnFocusId || "").trim();
  if (!id || typeof document === "undefined") return id;
  try {
    const node = document.getElementById(id);
    if (node && typeof node.focus === "function") {
      node.focus();
      node.classList.add("agency-return-focus");
      if (typeof window !== "undefined") window.setTimeout(() => node.classList.remove("agency-return-focus"), 2400);
    }
  } catch {
    /* focus restore is best-effort */
  }
  return id;
}

export function resolveStoryboardAttachTarget(storyboard, entity) {
  if (!storyboard || !entity) return null;
  if (entity.type === "storyboard-frame" && storyboard.frames?.[entity.id]) {
    return { kind: "frame", id: entity.id };
  }
  const clips = storyboard.clips && typeof storyboard.clips === "object" ? storyboard.clips : {};
  const clip = clips[entity.id] || Object.values(clips).find((item) => item?.id === entity.id);
  if (entity.type === "clip" && clip) {
    if (clip.videoPlanId && storyboard.videoPlans?.[clip.videoPlanId]) {
      return { kind: "video_plan", id: clip.videoPlanId };
    }
    if (clip.firstFrameId) return { kind: "frame", id: clip.firstFrameId };
  }
  if (entity.type === "segment") {
    const segment = storyboard.segments?.[entity.id];
    if (segment?.frameId) return { kind: "frame", id: segment.frameId };
  }
  return null;
}

export function currentStoryboardReferences(storyboard, target) {
  if (!storyboard || !target) return [];
  const references = target.kind === "frame"
    ? [...(storyboard.frames?.[target.id]?.references || [])]
    : target.kind === "video_plan"
      ? Object.values(storyboard.referenceBindings || {})
        .filter((binding) => binding?.targetKind === "video_plan" && binding?.targetId === target.id)
      : [];
  // Reference file paths and hashes are server-owned. Submit only the user's
  // exact asset/version/role choices when re-saving or merging a binding.
  return references
    .sort((left, right) => (
      (Number(left?.order) || 0) - (Number(right?.order) || 0)
      || String(left?.id || "").localeCompare(String(right?.id || ""))
    ))
    .map((reference) => ({
      id: reference.id,
      assetId: reference.assetId,
      assetVersion: reference.assetVersion,
      role: reference.role,
      useMode: reference.useMode,
      required: reference.required !== false,
      cropRegion: reference.cropRegion,
      notes: reference.notes
    }));
}

export function mergeStoryboardReference(existing, asset, category) {
  const assetId = typeof asset?.id === "string" ? asset.id.trim() : "";
  const assetVersion = Number(asset?.activeVersion);
  if (!assetId) throw new Error("A project asset ID is required before attaching a Storyboard reference.");
  if (!Number.isSafeInteger(assetVersion) || assetVersion < 1) {
    throw new Error(`Asset ${assetId} has no exact active version to attach.`);
  }
  const prior = (existing || []).find((item) => item?.assetId === assetId) || null;
  const next = (existing || []).filter((item) => item?.assetId !== assetId);
  next.push({
    ...(prior?.id ? { id: prior.id } : {}),
    assetId,
    assetVersion,
    role: roleForCategory(category),
    useMode: "semantic",
    required: true,
    cropRegion: "",
    notes: "Attached from the contextual asset drawer"
  });
  return next;
}


export function hashesOfVersion(version) {
  const hashes = [];
  if (Array.isArray(version?.fileHashes)) {
    for (const entry of version.fileHashes) hashes.push(String(entry?.sha256 || entry || "").toLowerCase());
  } else if (version?.fileHashes && typeof version.fileHashes === "object") {
    for (const value of Object.values(version.fileHashes)) hashes.push(String(value || "").toLowerCase());
  }
  if (version?.sha256) hashes.push(String(version.sha256).toLowerCase());
  return hashes.filter(Boolean);
}

export function findDuplicateHash(items, sha256) {
  const needle = String(sha256 || "").toLowerCase();
  if (!needle) return null;
  for (const asset of items || []) {
    for (const version of asset.versions || []) {
      if (hashesOfVersion(version).includes(needle)) {
        return { asset, version, sha256: needle };
      }
    }
  }
  return null;
}

export function assertNewFileHash(items, sha256) {
  const hit = findDuplicateHash(items, sha256);
  if (!hit) return null;
  const error = new Error(`Exact SHA-256 already exists as ${hit.asset.name} v${hit.version.v}. Reuse that version? A new vN+1 was not created.`);
  error.code = "DUPLICATE_HASH";
  error.existing = hit;
  throw error;
}

export function reuseExistingVersion(hit) {
  if (!hit?.asset || !hit?.version) throw new Error("Nothing to reuse.");
  return {
    reused: true,
    asset: {
      ...hit.asset,
      activeVersion: Number(hit.version.v),
      file: hit.version.file || hit.asset.file
    },
    version: hit.version,
    sha256: hit.sha256
  };
}

export function restoreAudit(asset, target) {
  const keptVersions = (asset?.versions || []).map((version) => Number(version.v)).sort((left, right) => left - right);
  return {
    op: "restore",
    assetId: asset?.id || "",
    fromVersion: Number(asset?.activeVersion || 0),
    toVersion: Number(target?.v || 0),
    keptVersions,
    deletedVersions: [],
    timestamp: new Date().toISOString(),
    opSource: "drawer"
  };
}

export function restoreAuditLine(asset, target) {
  const audit = restoreAudit(asset, target);
  return `VER restore ${audit.timestamp}: active v${audit.fromVersion} → v${audit.toVersion}; later versions kept (${audit.keptVersions.join(",") || "none"}); no delete; approval reset`;
}

export function attachAudit(intent, asset, result = {}, previous = {}) {
  const version = Number(asset?.activeVersion || result?.asset?.activeVersion || 0);
  const active = (asset?.versions || []).find((item) => Number(item.v) === version);
  return {
    sourceEntity: `${intent?.sourceEntity?.type || ""}:${intent?.sourceEntity?.id || ""}`,
    relationship: intent?.requirement?.relationship || "",
    previousRelationship: previous?.relationship || previous?.previousRelationship || "",
    assetId: asset?.id || result?.asset?.id || "",
    exactVersion: version,
    previousVersion: Number(previous?.previousVersion ?? previous?.assetVersion ?? 0),
    approvalFingerprint: String(asset?.approval?.versionFingerprint || active?.assetFingerprint || asset?.assetFingerprint || ""),
    timestamp: new Date().toISOString(),
    opSource: intent?.sourceRoute || "drawer",
    approved: Boolean(asset?.approvalCurrent)
  };
}

export function attachAuditLine(audit) {
  return `VER attach ${audit.timestamp}: entity ${audit.sourceEntity}; relationship ${audit.relationship}; previous ${audit.previousRelationship || "none"}; previous version ${audit.previousVersion || "none"}; asset ${audit.assetId} v${audit.exactVersion}; fingerprint ${audit.approvalFingerprint || "none"}; source ${audit.opSource}; approved ${audit.approved}`;
}

export async function sha256Hex(buffer, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error("SHA-256 is not available.");
  const digest = await cryptoImpl.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function previousVersion(asset) {
  const versions = [...(asset?.versions || [])].sort((left, right) => Number(left.v) - Number(right.v));
  const active = Number(asset?.activeVersion || 0);
  return versions.filter((version) => Number(version.v) < active).at(-1) || null;
}

export async function restoreForIntent(store, asset, versionNumber) {
  if (!asset) throw new Error("No asset to restore.");
  const target = versionNumber != null
    ? (asset.versions || []).find((version) => Number(version.v) === Number(versionNumber))
    : previousVersion(asset);
  if (!target) throw new Error("No earlier version to restore.");
  const keptBefore = (asset.versions || []).map((version) => Number(version.v));
  const audit = restoreAudit(asset, target);
  const line = restoreAuditLine(asset, target);
  const continuity = [...(Array.isArray(asset.continuity) ? asset.continuity : []), line];
  let next = null;
  if (typeof store.restoreAssetVersion === "function") {
    next = await store.restoreAssetVersion(asset.id, Number(target.v), { continuity, audit });
  } else if (typeof store.patchAsset === "function") {
    await store.patchAsset(asset.id, { activeVersion: Number(target.v), continuity });
  }
  const restored = next || { ...asset, activeVersion: Number(target.v), file: target.file, approvalCurrent: false, continuity };
  const keptAfter = (restored.versions || asset.versions || []).map((version) => Number(version.v));
  if (keptBefore.some((version) => !keptAfter.includes(version))) {
    throw new Error("Restore refused to delete a later version.");
  }
  restored.approvalCurrent = false;
  restored.restoreAudit = audit;
  return restored;
}


export function cueLinesForCharacter(name, storyboard) {
  const needle = String(name || "").toLowerCase().trim();
  const lines = [];
  const push = (text, speaker) => {
    const spoken = String(text || "").trim();
    if (!spoken) return;
    const who = String(speaker || "").toLowerCase();
    if (needle && who && !who.includes(needle) && !needle.includes(who)) return;
    if (!lines.includes(spoken)) lines.push(spoken);
  };
  const clips = storyboard?.clips;
  const clipList = Array.isArray(clips) ? clips : Object.values(clips || {});
  for (const clip of clipList) {
    const speaker = clip?.speaker || clip?.dialogueSpeaker || clip?.character;
    push(clip?.dialogueAnchor, speaker);
    for (const segment of clip?.segments || []) push(segment?.dialogueAnchor, segment?.speaker || speaker);
  }
  const segments = storyboard?.segments;
  const segmentList = Array.isArray(segments) ? segments : Object.values(segments || {});
  for (const segment of segmentList) {
    push(segment?.dialogueAnchor, segment?.speaker || segment?.dialogueSpeaker || segment?.character);
  }
  return lines;
}

export function locksFromBundle(bundle) {
  const out = [];
  for (const asset of [bundle?.primaryAsset, ...(bundle?.characterAssets || []), ...(bundle?.wardrobeAssets || []), ...(bundle?.voiceAssets || [])]) {
    for (const lock of asset?.continuity || asset?.continuityLocks || []) {
      const text = String(lock || "").trim();
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

export function withContinuityLocks(prompt, locks) {
  const list = Array.isArray(locks) ? locks.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const base = String(prompt || "").trim();
  if (!list.length) return base;
  if (/CONTINUITY LOCKS/i.test(base)) return base;
  return `${base}\n\nCONTINUITY LOCKS\n- ${list.join("\n- ")}`.trim();
}

export async function createPlannedAsset(store, intent, fields = {}) {
  const characterId = intent.sourceEntity?.type === "character" ? intent.sourceEntity.id : "";
  const created = await store.createAsset({
    name: String(fields.name || intent.sourceEntity.label || "").trim(),
    variant: fields.variant || (isVoiceCategory(intent.requirement.category) ? "Voice Design" : "Production Reference"),
    category: intent.requirement.category,
    prompt: fields.prompt || "",
    sampleText: fields.sampleText,
    workflowId: fields.workflowId,
    continuity: fields.continuity || fields.continuityLocks || intent.prefill?.continuity || intent.prefill?.continuityLocks || [],
    dependencies: withCharacterDependency([], characterId)
  });
  if (!created) throw new Error("Create asset failed.");
  return created;
}

export async function uploadForIntent(store, intent, file, asset) {
  if (!file) throw new Error("Choose a file first.");
  if (file.arrayBuffer && globalThis.crypto?.subtle) {
    const sha = await sha256Hex(await file.arrayBuffer());
    assertNewFileHash(store.project?.assets?.items, sha);
  }
  const target = asset || await createPlannedAsset(store, intent, { name: intent.sourceEntity.label });
  const audio = isVoiceCategory(intent.requirement.category) || intent.requirement.expectedMediaType === "audio";
  const next = audio ? await store.uploadAssetAudio(target.id, file) : await store.uploadAssetImage(target.id, file);
  return next || target;
}

export async function chooseForIntent(store, intent, asset) {
  if (!asset) throw new Error("Choose an existing asset first.");
  if (intent.sourceEntity?.type === "character") {
    await store.patchAsset(asset.id, { dependencies: withCharacterDependency(asset.dependencies, intent.sourceEntity.id) });
  }
  return asset;
}

export async function approveForIntent(store, asset) {
  if (!asset) throw new Error("No asset to review.");
  await store.approveAsset(asset.id);
  return { ...asset, approvalCurrent: true };
}

export async function unlinkForIntent(store, intent, asset) {
  if (!asset) throw new Error("No assigned asset to unlink.");
  if (intent.sourceEntity?.type !== "character") throw new Error("Unlink is implemented for character slots.");
  await store.patchAsset(asset.id, { dependencies: withoutCharacterDependency(asset.dependencies, intent.sourceEntity.id) });
  return asset;
}

export async function generateQwenVoice(store, intent, fields = {}, fetchImpl = globalThis.fetch) {
  const project = store.project;
  if (!project) throw new Error("No project is open.");
  const reason = generateBlockReason(intent, store.health);
  if (reason) throw new Error(reason);
  const voiceName = String(fields.voiceName || fields.name || intent.sourceEntity.label || "").trim();
  const instruct = String(fields.instruct || fields.prompt || "").trim() || `Stable cinematic voice identity for ${intent.sourceEntity.label}.`;
  const auditionText = String(fields.auditionText || fields.sampleText || (fields.cueLines || [])[0] || "").trim();
  if (!auditionText) throw new Error("This character has no cue line to audition. Offer a storyboard cue, not Voice Design enrollment.");
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(project.slug)}/sound/voice-design/auditions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      voiceName,
      characterId: intent.sourceEntity.type === "character" ? intent.sourceEntity.id : null,
      projectId: project.id || project.slug,
      language: fields.language || "English",
      auditionText,
      instruct,
      auditionCount: Number(fields.auditionCount || 3)
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Qwen Voice Design failed (${response.status}).`);
  if (store.refreshQueue) await store.refreshQueue();
  return { session: json.session, job: json.job, provider: "qwen-voice-design" };
}

export async function generateQwenTtsCue(store, intent, fields = {}, fetchImpl = globalThis.fetch) {
  const project = store.project;
  if (!project) throw new Error("No project is open.");
  const reason = generateBlockReason(intent, store.health);
  if (reason) throw new Error(reason);
  const text = String(fields.text || fields.sampleText || fields.auditionText || "").trim();
  if (!text) throw new Error("This segment has no dialogue cue to speak.");
  const body = new FormData();
  body.set("text", text);
  body.set("speaker", String(fields.speaker || intent.sourceEntity.label || "VO").trim() || "VO");
  body.set("name", String(fields.name || `${intent.sourceEntity.label} dialogue`).trim());
  body.set("provider", "qwenTts");
  body.set("language", fields.language || "EN");
  const cueId = String(intent.requirement?.expectedVariant || "").trim() || cueIdFromIntent(intent);
  body.set("attachToCue", "1");
  if (cueId) body.set("cueId", cueId);
  if (intent.sourceEntity?.type === "segment") body.set("segmentId", intent.sourceEntity.id);
  if (fields.voiceId) body.set("voiceId", fields.voiceId);
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(project.slug)}/sound/qwen-tts/generations`, {
    method: "POST",
    body
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Qwen TTS failed (${response.status}).`);
  if (store.refreshQueue) await store.refreshQueue();
  return { generation: json.generation, job: json.job, provider: "qwen-tts" };
}

export async function generateForIntent(store, intent, fields = {}, fetchImpl = globalThis.fetch) {
  const reason = generateBlockReason(intent, store.health);
  if (reason) throw new Error(reason);
  if (isDialogueCategory(intent.requirement.category)) {
    return generateQwenTtsCue(store, intent, fields, fetchImpl);
  }
  if (intent.requirement.category === "voice") {
    return generateQwenVoice(store, intent, fields, fetchImpl);
  }
  let asset = fields.asset;
  if (!asset) asset = await createPlannedAsset(store, intent, fields);
  const locks = fields.continuity || fields.continuityLocks || intent.prefill?.continuity || intent.prefill?.continuityLocks || asset.continuity || [];
  const lockedPrompt = withContinuityLocks(fields.prompt || asset.prompt, locks);
  const requestedWorkflowId = String(fields.workflowId || "").trim();
  const patch = {};
  if (locks.length || lockedPrompt !== String(asset.prompt || "")) {
    patch.prompt = lockedPrompt;
    patch.continuity = locks;
  }
  if (requestedWorkflowId && requestedWorkflowId !== String(asset.workflowId || "")) {
    patch.workflowId = requestedWorkflowId;
  }
  if (typeof store.patchAsset === "function" && Object.keys(patch).length) {
    await store.patchAsset(asset.id, patch);
    asset = { ...asset, ...patch };
  }
  await store.generateAsset(asset.id, requestedWorkflowId ? { workflowId: requestedWorkflowId } : undefined);
  let attached = null;
  if (fields.attachAfter !== false) {
    try {
      attached = await attachForIntent(store, intent, asset);
    } catch {
      attached = null;
    }
  }
  return { asset, provider: "comfy", attached };
}

export async function attachForIntent(store, intent, asset, fetchImpl = globalThis.fetch) {
  if (!asset) throw new Error("Nothing to attach yet.");
  const entity = intent.sourceEntity?.type;
  const relationship = String(intent.requirement?.relationship || "");
  const category = intent.requirement?.category;
  const route = sourceRoutePrefix(intent.sourceRoute);

  if (entity === "character") {
    await store.patchAsset(asset.id, { dependencies: withCharacterDependency(asset.dependencies, intent.sourceEntity.id) });
    const audit = attachAudit(intent, asset, { kind: "character-dependency" }, intent.requirement);
    return { kind: "character-dependency", asset, audit };
  }

  if (relationship === "ltx.dialogueCue" || route === "sound" || relationship === "cue.dialogueAudio") {
    return applyDialogueCueAttach(store, intent, asset, fetchImpl);
  }

  if (entity === "segment" && route !== "sound" && route !== "ltx" && relationship !== "ltx.dialogueCue" && typeof store.saveStoryboardDirection === "function") {
    const audioSlot = relationship === "segment.dialogueAudio" || relationship === "segment.ambience" || isVoiceCategory(category) || category === "sound";
    if (audioSlot) {
      const segment = store.storyboard?.segments?.[intent.sourceEntity.id];
      const clipId = segment?.clipId || intent.sourceEntity.label;
      const body = { segmentId: intent.sourceEntity.id, clipId };
      if (relationship === "segment.ambience" || category === "sound") body.ambience = asset.id;
      else body.dialogueAssetId = asset.id;
      await store.saveStoryboardDirection(body);
      const audit = attachAudit(intent, asset, { kind: "segment-audio" }, intent.requirement);
      return { kind: "segment-audio", asset, relationship, audit };
    }
  }

  if (STORYBOARD_ENTITIES.has(entity) && route !== "sound" && route !== "ltx") {
    const target = resolveStoryboardAttachTarget(store.storyboard, intent.sourceEntity);
    if (!target) throw new Error("No Storyboard frame or video plan is bound to this context.");
    const merged = mergeStoryboardReference(
      currentStoryboardReferences(store.storyboard, target),
      asset,
      intent.requirement.category
    );
    await store.replaceStoryboardReferences(target.kind, target.id, merged);
    const audit = attachAudit(intent, asset, { kind: "storyboard-reference", target }, intent.requirement);
    return { kind: "storyboard-reference", target, asset, audit };
  }

  if (entity === "guide") {
    return isLastGuideRelationship(relationship)
      ? applyLtxLastGuide(asset, intent, fetchImpl)
      : applyLtxFirstGuide(asset, intent, fetchImpl);
  }
  if (entity === "library") {
    const clipId = store.selectedStoryboardClipId;
    if (clipId) {
      return attachForIntent(store, {
        ...intent,
        sourceEntity: { type: "clip", id: clipId, label: clipId },
        sourceRoute: intent.sourceRoute || "/storyboard"
      }, asset, fetchImpl);
    }
    return { kind: "library-result", asset, relationship };
  }
  if (entity === "sequence") {
    return { kind: "sequence-slot", asset, relationship };
  }
  if (entity === "timeline-item") {
    return applyTimelineAttach(store, intent, asset, fetchImpl);
  }
  if (entity === "score" || entity === "master") {
    return { kind: "master-slot", asset, relationship: relationship || "master.score" };
  }
  if (entity === "export-blocker") {
    return { kind: "export-slot", asset, relationship };
  }
  return { kind: "slot-receipt", asset, relationship, entity, route };
}

export async function applyDialogueCueAttach(store, intent, asset, fetchImpl = globalThis.fetch) {
  const cueId = String(intent?.requirement?.expectedVariant || "").trim() || cueIdFromIntent(intent);
  const segmentId = String(intent.sourceEntity?.id || "").trim();
  const file = assetFileOf(asset);
  const returnFocusId = restoreReturnFocus({ returnFocusId: intent?.returnFocusId || (cueId ? `ltx-cue-${cueId}` : "") });
  try {
    const slug = store?.project?.slug;
    if (slug && asset?.id && typeof fetchImpl === "function") {
      try {
        await fetchImpl(`/api/projects/${encodeURIComponent(slug)}/sound/assets/${encodeURIComponent(asset.id)}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "associate", payload: { cueId, segmentId, attachToCue: 1, ltxCue: 1, file } })
        });
      } catch {
        /* bind still returns on the receipt */
      }
    }
    const audit = typeof attachAudit === "function" ? attachAudit(intent, asset, { kind: "ltx-dialogue-cue" }, intent.requirement) : undefined;
    return { kind: "ltx-dialogue-cue", asset, cueId, segmentId, file, approved: false, audit, returnFocusId, relationship: "ltx.dialogueCue" };
  } catch {
    return { kind: "ltx-dialogue-cue", asset, cueId, segmentId, file, approved: false, returnFocusId, relationship: "ltx.dialogueCue" };
  }
}

export async function applyTimelineAttach(store, intent, asset, fetchImpl = globalThis.fetch) {
  const slug = store.project?.slug;
  const track = String(intent.sourceEntity?.id || "A1");
  const playheadFrame = Number(store.playheadFrame || 0);
  if (slug && asset?.id) {
    try {
      await fetchImpl(`/api/projects/${encodeURIComponent(slug)}/sound/assets/${encodeURIComponent(asset.id)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "place_playhead", payload: { track, playheadFrame } })
      });
    } catch { /* generic receipt */ }
  }
  return { kind: "timeline-slot", asset, track, playheadFrame, relationship: intent.requirement?.relationship };
}

export async function applyLtxLastGuide(asset, intent, fetchImpl = globalThis.fetch) {
  const file = assetFileOf(asset);
  if (!file) throw new Error("This asset has no file to use as the last guide.");
  const response = await fetchImpl("/api/integrations/ltx/director/workspace");
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "Could not read the LTX workspace.");
  const workspace = json.workspace;
  if (!workspace?.timeline?.segments) throw new Error("LTX workspace has no segments.");
  const segmentId = String(intent.sourceEntity?.id || workspace.selectedSegmentId || "");
  const segments = workspace.timeline.segments;
  const index = segments.findIndex((item) => String(item.id) === segmentId);
  const segment = index >= 0 ? segments[index] : null;
  if (!segment) throw new Error("Select an LTX segment before using a last guide.");
  const next = index >= 0 && index < segments.length - 1 ? segments[index + 1] : null;
  if (!next) throw new Error("Last guide binds the next accepted frame. This segment has no next neighbor.");
  next.imageFile = file;
  next.projectMediaPath = file;
  next.missingGuide = false;
  next.fileName = asset.name || file;
  segment.useNextAsLastFrame = true;
  const saved = await fetchImpl("/api/integrations/ltx/director/workspace", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace })
  });
  const body = await saved.json().catch(() => ({}));
  if (!saved.ok) throw new Error(body.error || "Could not save the last guide.");
  return { kind: "ltx-last-guide", segmentId, nextSegmentId: next.id, asset, file };
}

export function auditionNativeUrl(slug, auditionId) {
  return `/api/projects/${encodeURIComponent(slug)}/sound/voice-design/auditions/${encodeURIComponent(auditionId)}/native`;
}

export async function fetchVoiceDesignState(slug, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(slug)}/sound/voice-design`);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Voice Design state failed (${response.status}).`);
  return json;
}

export function sessionFromVoiceDesign(snapshot, sessionId) {
  const sessions = snapshot?.voiceDesign?.sessions || [];
  return sessions.find((item) => item?.id === sessionId) || null;
}

export async function saveAuditionToLibrary(slug, auditionId, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(slug)}/sound/voice-design/auditions/${encodeURIComponent(auditionId)}/save-to-library`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Save audition failed (${response.status}).`);
  return json;
}

export async function selectAudition(slug, auditionId, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(slug)}/sound/voice-design/auditions/${encodeURIComponent(auditionId)}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Select audition failed (${response.status}).`);
  return json;
}

export const OFFLINE_MANUAL_ACTIONS = ["upload", "create", "choose", "review"];

export function assetFileOf(asset) {
  if (!asset) return "";
  if (asset.file) return String(asset.file);
  const versions = Array.isArray(asset.versions) ? asset.versions : [];
  const active = versions.find((version) => Number(version.v) === Number(asset.activeVersion));
  return String(active?.file || versions.at(-1)?.file || "");
}

export async function applyLtxFirstGuide(asset, intent, fetchImpl = globalThis.fetch) {
  const file = assetFileOf(asset);
  if (!file) throw new Error("This asset has no file to use as the first guide.");
  const response = await fetchImpl("/api/integrations/ltx/director/workspace");
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "Could not read the LTX workspace.");
  const workspace = json.workspace;
  if (!workspace?.timeline?.segments) throw new Error("LTX workspace has no segments.");
  const segmentId = String(intent.sourceEntity?.id || workspace.selectedSegmentId || "");
  const segment = workspace.timeline.segments.find((item) => String(item.id) === segmentId);
  if (!segment) throw new Error("Select an LTX segment before using a first guide.");
  segment.imageFile = file;
  segment.projectMediaPath = file;
  segment.missingGuide = false;
  segment.fileName = asset.name || file;
  segment.usePreviousAsFirstFrame = false;
  const saved = await fetchImpl("/api/integrations/ltx/director/workspace", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace })
  });
  const body = await saved.json().catch(() => ({}));
  if (!saved.ok) throw new Error(body.error || "Could not save the first guide.");
  return { kind: "ltx-first-guide", segmentId, asset, file };
}


export function nextMissingIntent(store, intent) {
  if (!intent || intent.sourceEntity?.type !== "character") return null;
  const items = store?.project?.assets?.items || [];
  const characterId = intent.sourceEntity.id;
  const related = items.filter((item) => item.id === characterId || (item.dependencies || []).includes(characterId));
  const hasWardrobe = related.some((item) => item.category === "wardrobe");
  const hasVoice = related.some((item) => item.category === "voice");
  if (!hasWardrobe && intent.requirement?.relationship !== "character.wardrobe") {
    return {
      ...intent,
      requirement: { relationship: "character.wardrobe", category: "wardrobe", expectedMediaType: "image" },
      initialAction: "generate",
      slotState: "missing"
    };
  }
  if (!hasVoice && intent.requirement?.relationship !== "character.voice") {
    return {
      ...intent,
      requirement: { relationship: "character.voice", category: "voice", expectedMediaType: "audio" },
      initialAction: "create",
      slotState: "missing"
    };
  }
  return null;
}
