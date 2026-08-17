import crypto from "node:crypto";

const VIDEO_RE = /\.(mp4|mov|mkv|webm|m4v)$/i;
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

function clone(value) {
  return structuredClone(value);
}

function positiveFrame(value, fallback = 1) {
  return Math.max(1, Math.round(Number(value) || fallback));
}

function safeStem(value) {
  return String(value || "music-video")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "music-video";
}

function ltxFrames(requestedFrames) {
  const requested = positiveFrame(requestedFrames);
  return Math.ceil((requested - 1) / 8) * 8 + 1;
}

function hasImageGuide(segment) {
  return segment?.type === "image" && Boolean(segment.imageFile || segment.imageB64 || segment.projectMediaPath);
}

function clippedTrack(segments, start, end) {
  return (segments || []).flatMap((source) => {
    const sourceStart = Math.max(0, Math.round(Number(source.start) || 0));
    const sourceLength = positiveFrame(source.length);
    const overlapStart = Math.max(sourceStart, start);
    const overlapEnd = Math.min(sourceStart + sourceLength, end);
    if (overlapEnd <= overlapStart) return [];
    const segment = clone(source);
    segment.start = overlapStart - start;
    segment.length = overlapEnd - overlapStart;
    if (overlapStart > sourceStart && segment.trimStart !== undefined) {
      segment.trimStart = (Number(segment.trimStart) || 0) + overlapStart - sourceStart;
    }
    return [segment];
  });
}

/**
 * Turn authored, contiguous timeline prompt segments into a deterministic
 * sequence of 5-10 second LTX jobs.  Text segments after the first are valid:
 * their image guide is supplied by node 201 from the preceding job.
 */
export function buildMusicVideoSequencePlan(workspace, options = {}) {
  const fps = Math.max(1, Number(workspace?.settings?.frameRate) || 24);
  const minFrames = positiveFrame(Number(options.minSeconds ?? 5) * fps);
  const maxFrames = positiveFrame(Number(options.maxSeconds ?? 10) * fps);
  const wantedIds = Array.isArray(options.shotIds) && options.shotIds.length
    ? new Set(options.shotIds.map(String))
    : null;
  const rangeStart = Math.max(0, Math.round(Number(options.startFrame) || 0));
  const rangeEnd = options.endFrame == null ? Number.POSITIVE_INFINITY : Math.max(rangeStart + 1, Math.round(Number(options.endFrame)));
  const sources = (workspace?.timeline?.segments || [])
    .filter((segment) => String(segment.prompt || "").trim())
    .filter((segment) => positiveFrame(segment.length) > 0)
    .filter((segment) => !wantedIds || wantedIds.has(String(segment.id)))
    .filter((segment) => {
      const start = Math.max(0, Math.round(Number(segment.start) || 0));
      const end = start + positiveFrame(segment.length);
      return start >= rangeStart && end <= rangeEnd;
    })
    .sort((a, b) => Number(a.start || 0) - Number(b.start || 0));

  if (!sources.length) throw new Error("The timeline has no authored music-video shots in the requested range");
  const firstStart = Math.max(0, Math.round(Number(sources[0].start) || 0));
  const firstGuide = hasImageGuide(sources[0])
    ? sources[0]
    : (workspace.timeline.segments || []).find((segment) => {
        const start = Math.max(0, Math.round(Number(segment.start) || 0));
        const end = start + positiveFrame(segment.length);
        return hasImageGuide(segment) && start <= firstStart && end > firstStart;
      });
  if (!firstGuide) throw new Error("The first music-video shot needs an approved image guide");

  let expectedStart = firstStart;
  const shots = sources.map((source, index) => {
    const startFrame = Math.max(0, Math.round(Number(source.start) || 0));
    const requestedFrames = positiveFrame(source.length);
    if (startFrame !== expectedStart) {
      throw new Error(`Music-video shots must be contiguous: ${source.id || index + 1} starts at ${startFrame}, expected ${expectedStart}`);
    }
    if (requestedFrames < minFrames || requestedFrames > maxFrames) {
      throw new Error(`Music-video shot ${source.id || index + 1} is ${(requestedFrames / fps).toFixed(3)}s; each sequential LTX job must be ${options.minSeconds ?? 5}-${options.maxSeconds ?? 10}s`);
    }
    expectedStart = startFrame + requestedFrames;
    return {
      index,
      id: String(source.id || `shot-${String(index + 1).padStart(3, "0")}`),
      startFrame,
      requestedFrames,
      generationFrames: ltxFrames(requestedFrames),
      prompt: String(source.prompt || "").trim(),
      manifestBlockId: source.manifestBlockId || null,
      manifestClipId: source.manifestClipId || null,
      guideStrength: Number.isFinite(Number(source.guideStrength))
        ? Number(source.guideStrength)
        : Number(workspace.settings.guideStrength || 1)
    };
  });

  return {
    schema: "premiere316.music-video-sequence-plan/v1",
    fps,
    width: positiveFrame(workspace.settings.customWidth, 1024),
    height: positiveFrame(workspace.settings.customHeight, 576),
    startFrame: shots[0].startFrame,
    endFrame: shots.at(-1).startFrame + shots.at(-1).requestedFrames,
    requestedFrames: shots.reduce((sum, shot) => sum + shot.requestedFrames, 0),
    firstGuide: clone(firstGuide),
    shots
  };
}

/**
 * Materialize a project-owned multi-clip storyboard manifest as one Director
 * timeline.  The source storyboard clips stay untouched; their IDs are kept
 * as master provenance while the sequential runner owns the cross-clip
 * boundary handoffs.
 */
export function workspaceFromMusicVideoManifest(baseWorkspace, manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("Music-video manifest is required");
  const blocks = Array.isArray(manifest.blocks) && manifest.blocks.length
    ? manifest.blocks
    : (Array.isArray(manifest.shots) ? [{ id: manifest.id || "music-video", startFrame: 0, endFrame: manifest.totalFrames, shots: manifest.shots }] : []);
  const shots = blocks.flatMap((block) => {
    const blockStart = Math.max(0, Math.round(Number(block.startFrame ?? block.start) || 0));
    const rawBlockEnd = block.endFrame ?? block.end;
    const blockEnd = rawBlockEnd == null ? Number.POSITIVE_INFINITY : Math.max(blockStart + 1, Math.round(Number(rawBlockEnd)));
    return (block.shots || []).map((shot, shotIndex) => {
      const startFrame = Math.max(0, Math.round(Number(shot.startFrame ?? shot.start) || 0));
      const length = positiveFrame(shot.length ?? shot.durationFrames ?? (Number(shot.endFrame ?? shot.end) - startFrame));
      if (startFrame < blockStart || startFrame + length > blockEnd) {
        throw new Error(`Music-video shot ${shot.id || "unknown"} falls outside block ${block.id || block.clipId || "unknown"}`);
      }
      return {
        ...shot,
        startFrame,
        length,
        blockId: block.id || block.clipId || null,
        clipId: shot.clipId
          || shot.storyboardClipId
          || block.clipId
          || block.clipIds?.[shotIndex]
          || block.storyboardClipIds?.[shotIndex]
          || null
      };
    });
  });
  if (!shots.length) throw new Error("Music-video manifest contains no shots");
  const workspace = clone(baseWorkspace);
  const fps = Math.max(1, Number(manifest.fps) || Number(workspace.settings.frameRate) || 24);
  workspace.settings.frameRate = fps;
  workspace.settings.customWidth = positiveFrame(manifest.width, workspace.settings.customWidth || 1024);
  workspace.settings.customHeight = positiveFrame(manifest.height, workspace.settings.customHeight || 576);
  if (manifest.negativePrompt != null) workspace.settings.negativePrompt = String(manifest.negativePrompt);
  if (manifest.imageCompression != null) workspace.settings.imageCompression = Number(manifest.imageCompression);
  workspace.timeline.global_prompt = String(manifest.globalPrompt || workspace.timeline.global_prompt || "");
  workspace.timeline.segments = shots.map((shot, index) => {
    const projectMediaPath = shot.guideProjectMediaPath
      || shot.firstFrameProjectMediaPath
      || shot.guide?.projectMediaPath
      || shot.projectMediaPath
      || null;
    return {
      id: String(shot.id || `music-shot-${String(index + 1).padStart(3, "0")}`),
      start: Math.max(0, Math.round(Number(shot.startFrame) || 0)),
      length: positiveFrame(shot.length ?? shot.durationFrames),
      prompt: String(shot.prompt || shot.directorPrompt || shot.videoPrompt || shot.visualPrompt || ""),
      type: projectMediaPath ? "image" : "text",
      ...(projectMediaPath ? {
        projectMediaPath: String(projectMediaPath).replace(/\\/g, "/"),
        fileName: String(projectMediaPath).split(/[\\/]/).at(-1),
        ...(shot.guideBytes || shot.projectMediaBytes ? { projectMediaBytes: Number(shot.guideBytes || shot.projectMediaBytes) } : {}),
        ...(shot.guideSha256 || shot.projectMediaSha256 ? { projectMediaSha256: String(shot.guideSha256 || shot.projectMediaSha256) } : {}),
        guideStrength: Number.isFinite(Number(shot.guideStrength)) ? Number(shot.guideStrength) : 1,
        isEndFrame: false
      } : {}),
      manifestBlockId: shot.blockId,
      manifestClipId: shot.clipId
    };
  });
  workspace.timeline.normalStartFrame = 0;
  workspace.timeline.normalDurationFrames = Math.max(...workspace.timeline.segments.map((segment) => segment.start + segment.length));
  workspace.timeline.motionSegments = [];
  workspace.timeline.audioSegments = [];
  workspace.settings.queueMode = "music-video-sequence";
  workspace.manifest = {
    schema: String(manifest.schema || "premiere316.music-video-manifest/v1"),
    id: String(manifest.id || "music-video"),
    title: String(manifest.title || "Music Video"),
    projectSlug: String(manifest.projectSlug || ""),
    clipIds: [...new Set(shots.map((shot) => shot.clipId).filter(Boolean).map(String))],
    blockIds: blocks.map((block) => String(block.id || block.clipId || "")).filter(Boolean),
    totalFrames: positiveFrame(manifest.totalFrames, workspace.timeline.normalDurationFrames),
    lyrics: manifest.lyrics == null ? null : String(manifest.lyrics),
    audioMetadata: clone(manifest.audioMetadata || null)
  };
  return workspace;
}

/** Build the one-shot Director job used by workflow-compiler.patchPrompt. */
export function buildMusicVideoShotJob(workspace, plan, shotIndex, guideFile = null) {
  const shot = plan?.shots?.[shotIndex];
  if (!shot) throw new Error(`Music-video shot index ${shotIndex} does not exist`);
  const firstGuide = plan.firstGuide || {};
  const resolvedGuide = guideFile || firstGuide.imageFile;
  if (!resolvedGuide) throw new Error(`Music-video shot ${shot.id} has no ComfyUI image guide`);
  const timeline = clone(workspace.timeline || {});
  const originalEnd = shot.startFrame + shot.requestedFrames;
  // LTX generates on an 8n+1 boundary. Give its audio latent the same
  // conditioning window as the video latent, including the one-frame
  // lookahead that becomes node 201's handoff frame. The editorial video is
  // still cropped back to requestedFrames by node 206, and the final master
  // receives the original soundtrack independently.
  const conditioningEnd = shot.startFrame + shot.generationFrames;
  timeline.retakeMode = false;
  timeline.normalStartFrame = 0;
  timeline.normalDurationFrames = shot.generationFrames;
  timeline.segments = [{
    id: shot.id,
    start: 0,
    length: shot.generationFrames,
    prompt: shot.prompt,
    type: "image",
    imageFile: resolvedGuide,
    fileName: String(resolvedGuide).split(/[\\/]/).at(-1),
    isEndFrame: false,
    guideStrength: shot.guideStrength
  }];
  timeline.motionSegments = clippedTrack(workspace.timeline?.motionSegments, shot.startFrame, originalEnd);
  timeline.audioSegments = clippedTrack(workspace.timeline?.audioSegments, shot.startFrame, conditioningEnd);
  return {
    index: shot.index + 1,
    total: plan.shots.length,
    sourceSegmentId: shot.id,
    requestedFrames: shot.requestedFrames,
    generationFrames: shot.generationFrames,
    durationFrames: shot.generationFrames,
    durationSeconds: shot.generationFrames / plan.fps,
    sourceStartFrame: shot.startFrame,
    timeline,
    localPrompts: shot.prompt,
    segmentLengths: String(shot.generationFrames),
    guideStrength: Number(shot.guideStrength).toFixed(2)
  };
}

export function musicVideoOutputPrefixes(runId, shotIndex) {
  const run = safeStem(runId);
  const shot = `shot_${String(Number(shotIndex) + 1).padStart(3, "0")}`;
  return {
    root: `director_webapp/music_video/${run}`,
    video: `director_webapp/music_video/${run}/${shot}`,
    handoff: `director_webapp/music_video/${run}/handoff/${shot}_boundary`
  };
}

/** Enforce the exact node contract expected by the durable sequence runner. */
export function patchMusicVideoSequencePrompt(promptValue, runId, shot) {
  const prompt = clone(promptValue);
  const video = prompt["94"];
  const handoff = prompt["201"];
  const crop = prompt["206"];
  const lastFrame = prompt["200"];
  if (video?.class_type !== "VHS_VideoCombine") throw new Error("Music-video workflow output node 94 must be VHS_VideoCombine");
  if (handoff?.class_type !== "SaveImage") throw new Error("Music-video workflow boundary node 201 must be SaveImage");
  if (crop?.class_type !== "ImageFromBatch") throw new Error("Music-video workflow crop node 206 must be ImageFromBatch");
  if (lastFrame?.class_type !== "ImageFromBatch") throw new Error("Music-video workflow last-frame node 200 must be ImageFromBatch");
  const prefixes = musicVideoOutputPrefixes(runId, shot.index);
  video.inputs.filename_prefix = prefixes.video;
  // Do not let a short conditioning-audio slice truncate the exact picture.
  // The untouched source soundtrack is applied once during final assembly.
  video.inputs.trim_to_audio = false;
  handoff.inputs.filename_prefix = prefixes.handoff;
  crop.inputs.batch_index = 0;
  crop.inputs.length = shot.requestedFrames;
  lastFrame.inputs.batch_index = -1;
  lastFrame.inputs.length = 1;
  return { prompt, prefixes };
}

function refsFromNode(node) {
  const refs = [];
  for (const key of ["videos", "video", "gifs", "images", "audio"]) {
    for (const ref of Array.isArray(node?.[key]) ? node[key] : []) {
      if (ref?.filename) refs.push(clone(ref));
    }
  }
  return refs;
}

export function sequenceHistoryOutputs(historyEntry) {
  if (!historyEntry?.outputs?.["94"]) throw new Error("Completed music-video shot is missing required video output node 94");
  if (!historyEntry?.outputs?.["201"]) throw new Error("Completed music-video shot is missing required boundary-frame output node 201");
  const video = refsFromNode(historyEntry.outputs["94"]).find((ref) => VIDEO_RE.test(ref.filename));
  const handoff = refsFromNode(historyEntry.outputs["201"]).find((ref) => IMAGE_RE.test(ref.filename));
  if (!video) throw new Error("Music-video output node 94 did not save a video file");
  if (!handoff) throw new Error("Music-video output node 201 did not save a boundary image");
  return { video, handoff };
}

export function createMusicVideoSequenceRecord({
  id = `director_music_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
  binding,
  plan,
  workspace,
  soundtrack
}) {
  if (!binding?.projectSlug || (!binding?.clipId && !(Array.isArray(binding?.clipIds) && binding.clipIds.length))) {
    throw new Error("A selected Premiere clip or storyboard clip sequence is required for a durable music-video run");
  }
  if (!soundtrack?.projectMediaPath || !soundtrack?.sha256 || !soundtrack?.bytes) {
    throw new Error("The source soundtrack must be pinned in the Premiere project with bytes and SHA-256");
  }
  const createdAt = new Date().toISOString();
  return {
    id,
    type: "director_music_video",
    projectSlug: binding.projectSlug,
    label: `LTX 2.5 Music Video · ${binding.clipId || `${binding.clipIds.length} storyboard clips`} · ${plan.shots.length} shots`,
    status: "queued",
    progress: 0,
    stage: `Preparing shot 1 of ${plan.shots.length}`,
    error: null,
    refs: {
      binding: clone(binding),
      plan: clone(plan),
      workspace: clone(workspace),
      soundtrack: clone(soundtrack),
      currentShotIndex: 0,
      shots: plan.shots.map((shot) => ({
        ...clone(shot),
        status: "pending",
        promptId: null,
        video: null,
        handoff: null,
        handoffComfyFile: null
      }))
    },
    result: null,
    createdAt,
    finishedAt: null
  };
}

export function markMusicVideoShotAccepted(recordValue, shotIndex, promptId, prefixes) {
  const record = clone(recordValue);
  const shot = record.refs?.shots?.[shotIndex];
  if (!shot) throw new Error(`Music-video shot index ${shotIndex} does not exist`);
  if (!promptId) throw new Error("ComfyUI did not return a prompt id for the music-video shot");
  shot.status = "queued";
  shot.promptId = String(promptId);
  shot.outputPrefixes = clone(prefixes);
  shot.queuedAt = new Date().toISOString();
  record.refs.currentShotIndex = shotIndex;
  record.status = "queued";
  record.stage = `Queued shot ${shotIndex + 1} of ${record.refs.shots.length}`;
  record.progress = shotIndex / record.refs.shots.length;
  return record;
}

export function markMusicVideoShotSaved(recordValue, shotIndex, outputs) {
  const record = clone(recordValue);
  const shot = record.refs?.shots?.[shotIndex];
  if (!shot) throw new Error(`Music-video shot index ${shotIndex} does not exist`);
  if (!outputs?.video?.file || !outputs?.video?.sha256 || !outputs?.handoff?.file || !outputs?.handoff?.sha256) {
    throw new Error("Saved music-video shot outputs require pinned video and handoff files");
  }
  shot.status = "done";
  shot.video = clone(outputs.video);
  shot.handoff = clone(outputs.handoff);
  shot.finishedAt = new Date().toISOString();
  const complete = record.refs.shots.filter((item) => item.status === "done").length;
  record.progress = complete / record.refs.shots.length;
  record.stage = complete === record.refs.shots.length
    ? "All shots saved; assembling master"
    : `Shot ${shotIndex + 1} saved; preparing shot ${shotIndex + 2}`;
  record.status = complete === record.refs.shots.length ? "finalizing" : "running";
  // Keep ownership on the completed shot until the next prompt is durably
  // accepted. A restart in the handoff/upload window can then replay the
  // idempotent materialization step instead of losing the sequence cursor.
  record.refs.currentShotIndex = shotIndex;
  return record;
}
