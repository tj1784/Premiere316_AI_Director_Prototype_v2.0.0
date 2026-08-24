import path from "path";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import { execFile } from "node:child_process";
import {
  uploadImage,
  runPrompt,
  downloadOutput,
  collectOutputFiles,
  getObjectInfo,
  getComfyQueueState,
  releaseComfyGpuMemory
} from "./comfy.js";
import { fillI2vPrompt, clampDuration, framesOf } from "./timeline.js";
import {
  H3_DISPLAY_NAME,
  H3_FPS,
  H3_MODE_FIRST,
  H3_MODE_REFERENCE,
  H3_MODES,
  H3_MODEL_FILES,
  buildH3Workflow,
  compileH3Prompt,
  h3Diagnostics,
  h3Dimensions,
  randomH3Seed
} from "./h3.js";
import {
  loadProject,
  saveProject,
  findClip,
  mediaDir,
  skipApproval
} from "./projects.js";
import {
  trimVideoToFrames,
  concatVideos,
  concatPreparedVideos,
  finalizeMasterMedia,
  concatVideoSegments,
  generatePrototypeScore,
  mixScore,
  probeMedia,
  renderMasterBookend
} from "./ffmpeg.js";
import { assetApprovalCurrent, generateAssetJob, restoreCancelledAsset } from "./assets.js";
import {
  generateStoryboardFrameJob,
  generateStoryboardVideoPlanJob,
  markStoryboardFrameGenerationFailed,
  markStoryboardVideoPlanGenerationFailed,
  restoreStoryboardFrameAfterCancellation,
  restoreStoryboardVideoPlanAfterCancellation
} from "./storyboard-generation.js";
import { projectDir } from "./paths.js";
import {
  BOOKEND_DURATION_SEC,
  BOOKEND_OPENING_TITLE,
  bookendDurationSec,
  normalizeBookends
} from "./bookends.js";
import { buildEditMasterJob } from "./sequence-editor.js";
import { cancelIndexTtsGeneration, generateIndexTtsJob, unloadIndexTtsModel } from "./index-tts.js";
import {
  cancelQwenTtsGeneration,
  cancelQwenTtsWorker,
  generateQwenTtsJob,
  unloadQwenTtsModel
} from "./qwen-tts.js";
import {
  cancelQwenVoiceDesignInstall,
  cancelQwenVoiceDesignWorker,
  cancelVoiceDesignSession,
  generateVoiceDesignJob,
  installQwenVoiceDesignJob,
  unloadQwenVoiceDesign
} from "./qwen-voice-design.js";
import {
  acquireGpuLease,
  gpuLeaseStatus,
  releaseGpuLease,
  updateGpuLease,
  GPU_RESOURCE_OWNERS
} from "./gpu-resource-manager.js";
import {
  generatePromptAssetJob,
  markPromptGenerationFailed,
  restorePromptGenerationAfterCancellation
} from "./prompt-generation.js";
import { finalizeAssetPromptAudioGeneration } from "./asset-prompt-audio.js";
import { markAudioGenerationCancelled, markAudioGenerationFailed, runAudioGenerationJob } from "./audio-generation.js";
import { isExternalQueueJobId, listExternalQueueJobs } from "./external-h02-queue.js";

const jobs = [];
let running = false;
let activeJob = null;
let activeAbortController = null;
const COMFY_PROMPT_JOB_TYPES = new Set([
  "render_range",
  "render_h3_range",
  "generate_asset",
  "generate_prompt_asset",
  "generate_audio_workflow",
  "generate_storyboard_frame",
  "generate_storyboard_video_plan"
]);
const LOCAL_PRIORITY_JOB_TYPES = new Set(["build_edit_master"]);
const LOCAL_CANCELLABLE_JOB_TYPES = new Set([
  "build_edit_master",
  "generate_index_tts",
  "generate_qwen_tts",
  "generate_qwen_voice_design",
  "install_qwen_voice_design"
]);

function persistJobLedger(projectSlug) {
  if (!projectSlug) return;
  try {
    const root = projectDir(projectSlug);
    fs.mkdirSync(root, { recursive: true });
    const entries = jobs.filter((job) => job.projectSlug === projectSlug).slice(-250).map((job) => ({
      id: job.id,
      type: job.type,
      label: job.label,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      error: job.error,
      refs: job.refs,
      result: job.result,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt
    }));
    fs.writeFileSync(path.join(root, "generation-jobs.json"), JSON.stringify({ updatedAt: new Date().toISOString(), jobs: entries }, null, 2));
  } catch (error) {
    console.warn("[queue] could not persist project job ledger:", error.message);
  }
}

export function listJobs() {
  const internalJobs = jobs.slice(-120).map((j) => ({
    id: j.id,
    projectSlug: j.projectSlug,
    type: j.type,
    label: j.label,
    status: j.status,
    progress: j.progress,
    stage: j.stage,
    error: j.error,
    refs: j.refs,
    result: j.result,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt
  }));
  return [...internalJobs, ...listExternalQueueJobs()];
}

export function enqueue(job) {
  if (job?.type === "generate_audio_workflow" && job?.projectSlug) {
    const requestedIds = new Set([
      ...(Array.isArray(job.generationIds) ? job.generationIds : []),
      ...(Array.isArray(job.refs?.generationIds) ? job.refs.generationIds : [])
    ].map(String));
    const existing = jobs.find((candidate) => {
      if (
        candidate.projectSlug !== job.projectSlug ||
        candidate.type !== "generate_audio_workflow" ||
        !["queued", "running", "cancelling"].includes(candidate.status)
      ) return false;
      const candidateIds = [
        ...(Array.isArray(candidate.generationIds) ? candidate.generationIds : []),
        ...(Array.isArray(candidate.refs?.generationIds) ? candidate.refs.generationIds : [])
      ].map(String);
      return candidateIds.some((id) => requestedIds.has(id));
    });
    if (existing) return existing;
  }
  if (job?.type === "install_qwen_voice_design") {
    const existing = jobs.find((candidate) =>
      candidate.type === "install_qwen_voice_design" &&
      ["queued", "running", "cancelling"].includes(candidate.status)
    );
    if (existing) return existing;
  }
  if (job?.type === "generate_qwen_voice_design" && job?.projectSlug && job?.refs?.sessionId) {
    const existing = jobs.find((candidate) =>
      candidate.projectSlug === job.projectSlug &&
      candidate.type === "generate_qwen_voice_design" &&
      candidate.refs?.sessionId === job.refs.sessionId &&
      ["queued", "running", "cancelling"].includes(candidate.status)
    );
    if (existing) return existing;
  }
  if (job?.type === "generate_index_tts" && job?.projectSlug && job?.refs?.generationId) {
    const existing = jobs.find((candidate) =>
      candidate.projectSlug === job.projectSlug &&
      candidate.type === "generate_index_tts" &&
      candidate.refs?.generationId === job.refs.generationId &&
      ["queued", "running", "cancelling"].includes(candidate.status)
    );
    if (existing) return existing;
  }
  if (job?.type === "generate_qwen_tts" && job?.projectSlug && job?.refs?.generationId) {
    const existing = jobs.find((candidate) =>
      candidate.projectSlug === job.projectSlug &&
      candidate.type === "generate_qwen_tts" &&
      candidate.refs?.generationId === job.refs.generationId &&
      ["queued", "running", "cancelling"].includes(candidate.status)
    );
    if (existing) return existing;
  }
  if (job?.type === "build_edit_master" && job?.projectSlug && job?.refs?.revision != null) {
    const existing = jobs.find((candidate) =>
      candidate.projectSlug === job.projectSlug &&
      candidate.type === "build_edit_master" &&
      Number(candidate.refs?.revision) === Number(job.refs.revision) &&
      ["queued", "running", "cancelling"].includes(candidate.status)
    );
    if (existing) return existing;
  }
  if (job?.type === "generate_asset" && job?.projectSlug && job?.refs?.assetId) {
    const existing = jobs.find((candidate) =>
      candidate.projectSlug === job.projectSlug &&
      candidate.type === "generate_asset" &&
      candidate.refs?.assetId === job.refs.assetId &&
      ["queued", "running", "cancelling"].includes(candidate.status)
    );
    if (existing) return existing;
  }
  if (job?.type === "generate_prompt_asset" && job?.projectSlug && job?.refs?.requestFingerprint) {
    const existing = jobs.find((candidate) =>
      candidate.projectSlug === job.projectSlug &&
      candidate.type === "generate_prompt_asset" &&
      candidate.refs?.requestFingerprint === job.refs.requestFingerprint &&
      ["queued", "running", "cancelling"].includes(candidate.status)
    );
    if (existing) return existing;
  }
  if (job?.type === "generate_storyboard_frame" && job?.projectSlug && job?.refs?.frameId) {
    const existing = jobs.find((candidate) =>
      candidate.projectSlug === job.projectSlug &&
      candidate.type === "generate_storyboard_frame" &&
      candidate.refs?.frameId === job.refs.frameId &&
      ["queued", "running", "cancelling"].includes(candidate.status)
    );
    if (existing) return existing;
  }
  if (job?.type === "generate_storyboard_video_plan" && job?.projectSlug && job?.refs?.videoPlanId) {
    const existing = jobs.find((candidate) =>
      candidate.projectSlug === job.projectSlug &&
      candidate.type === "generate_storyboard_video_plan" &&
      candidate.refs?.videoPlanId === job.refs.videoPlanId &&
      ["queued", "running", "cancelling"].includes(candidate.status)
    );
    if (existing) return existing;
  }
  const privateSequenceSnapshot = job?.sequenceSnapshot;
  const publicJob = { ...job };
  delete publicJob.sequenceSnapshot;
  const j = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    status: "queued",
    progress: 0,
    stage: "Queued",
    error: null,
    result: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    ...publicJob
  };
  if (privateSequenceSnapshot) {
    Object.defineProperty(j, "sequenceSnapshot", { value: privateSequenceSnapshot, configurable: true });
  }
  jobs.push(j);
  persistJobLedger(j.projectSlug);
  pump();
  return j;
}

export function cancelJob(id) {
  if (isExternalQueueJobId(id)) return false;
  const j = jobs.find((x) => x.id === id);
  if (!j) return false;
  if (j.status === "queued") {
    j.status = "cancelled";
    j.stage = "Stopped";
    j.finishedAt = new Date().toISOString();
    if (j.type === "generate_asset") restoreCancelledAsset(j.projectSlug, j.refs?.assetId);
    if (j.type === "generate_prompt_asset") restorePromptGenerationAfterCancellation(j.projectSlug, j.refs?.generationId);
    if (j.type === "generate_storyboard_frame") restoreStoryboardFrameAfterCancellation(j.projectSlug, j.refs?.frameId);
    if (j.type === "generate_storyboard_video_plan") restoreStoryboardVideoPlanAfterCancellation(j.projectSlug, j.refs?.videoPlanId);
    if (j.type === "generate_index_tts") cancelIndexTtsGeneration(j.projectSlug, j.refs?.generationId);
    if (j.type === "generate_qwen_tts") cancelQwenTtsGeneration(j.projectSlug, j.refs?.generationId);
    if (j.type === "generate_qwen_voice_design") cancelVoiceDesignSession(j.projectSlug, j.refs?.sessionId);
    if (j.type === "generate_audio_workflow") {
      const generationIds = Array.isArray(j.generationIds) ? j.generationIds : j.refs?.generationIds || [];
      for (const generationId of generationIds) {
        try { markAudioGenerationCancelled(j.projectSlug, generationId); } catch {}
      }
    }
    if (j.refs?.promptGenerationId) {
      try {
        finalizeAssetPromptAudioGeneration(j.projectSlug, j.refs.promptGenerationId, {
          status: "cancelled",
          jobId: j.id
        });
      } catch {}
    }
    persistJobLedger(j.projectSlug);
    return true;
  }
  const localJob = LOCAL_CANCELLABLE_JOB_TYPES.has(j.type);
  const ownsRunningJob = activeJob?.id === j.id;
  if (j.status === "running" && (COMFY_PROMPT_JOB_TYPES.has(j.type) || localJob) && ownsRunningJob) {
    j.status = "cancelling";
    j.stage = COMFY_PROMPT_JOB_TYPES.has(j.type)
      ? "Stopping ComfyUI prompt…"
      : j.type === "generate_index_tts"
        ? "Stopping IndexTTS generation…"
        : j.type === "generate_qwen_tts"
          ? "Stopping standalone Qwen3-TTS generation…"
        : j.type === "generate_qwen_voice_design"
          ? "Stopping Qwen VoiceDesign generation and releasing its model…"
          : j.type === "install_qwen_voice_design"
            ? "Stopping Qwen VoiceDesign installation…"
        : "Stopping export…";
    persistJobLedger(j.projectSlug);
    if (j.type === "install_qwen_voice_design") cancelQwenVoiceDesignInstall();
    if (j.type === "generate_qwen_voice_design") cancelQwenVoiceDesignWorker();
    if (j.type === "generate_qwen_tts") cancelQwenTtsWorker();
    activeAbortController?.abort();
    return true;
  }
  return false;
}

export function cancelAssetJobs(projectSlug, assetId = null) {
  const targets = jobs.filter((job) =>
    job.projectSlug === projectSlug &&
    job.type === "generate_asset" &&
    ["queued", "running", "cancelling"].includes(job.status) &&
    (!assetId || job.refs?.assetId === assetId)
  );
  let stopped = 0;
  for (const job of targets) {
    if (job.status === "cancelling" || cancelJob(job.id)) stopped += 1;
  }
  return { stopped, jobIds: targets.map((job) => job.id) };
}

async function pump() {
  if (running) return;
  const next = jobs.find((job) => job.status === "queued" && LOCAL_PRIORITY_JOB_TYPES.has(job.type))
    || jobs.find((job) => job.status === "queued");
  if (!next) return;
  running = true;
  activeJob = next;
  activeAbortController = new AbortController();
  Object.defineProperty(next, "signal", { value: activeAbortController.signal, configurable: true });
  next.status = "running";
  next.progress = 0;
  persistJobLedger(next.projectSlug);
  try {
    if (COMFY_PROMPT_JOB_TYPES.has(next.type)) await prepareGpuForComfy(next);
    if (next.type === "generate_index_tts") {
      await prepareLocalGpuRuntime(GPU_RESOURCE_OWNERS.INDEX_TTS, { job: next });
    }
    if (next.type === "generate_qwen_tts") {
      await prepareStandaloneQwenTtsRuntime({ job: next });
    }
    if (next.type === "generate_qwen_voice_design") {
      await prepareLocalGpuRuntime(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, { job: next });
    }
    if (next.type === "render_range") await renderRange(next);
    else if (next.type === "render_h3_range") await renderH3Range(next);
    else if (next.type === "assemble_clip") await assembleClipJob(next);
    else if (next.type === "generate_score") await generateScore(next);
    else if (next.type === "generate_asset") await generateAssetJob(next);
    else if (next.type === "generate_prompt_asset") await generatePromptAssetJob(next);
    else if (next.type === "generate_storyboard_frame") await generateStoryboardFrameJob(next);
    else if (next.type === "generate_storyboard_video_plan") await generateStoryboardVideoPlanJob(next);
    else if (next.type === "build_master") await buildMaster(next);
    else if (next.type === "build_edit_master") await buildEditMasterJob(next);
    else if (next.type === "generate_index_tts") await generateIndexTtsJob(next);
    else if (next.type === "generate_qwen_tts") await generateQwenTtsJob(next);
    else if (next.type === "generate_qwen_voice_design") await generateVoiceDesignJob(next);
    else if (next.type === "generate_audio_workflow") {
      next.stage = "Submitting validated audio workflow";
      next.result = await runAudioGenerationJob(next, {
        signal: next.signal,
        manageGpuLease: false,
        onSubmitted: ({ generationId, promptId }) => {
          next.refs = next.refs || {};
          next.refs.promptIds = { ...(next.refs.promptIds || {}), [generationId]: promptId };
          next.stage = `ComfyUI audio · ${promptId}`;
          persistJobLedger(next.projectSlug);
        },
        onProgress: ({ ratio, nodeId, promptId }) => {
          next.progress = Math.min(0.96, 0.04 + Math.max(0, Math.min(1, Number(ratio) || 0)) * 0.9);
          next.stage = `Generating audio${nodeId ? ` · node ${nodeId}` : ""}${promptId ? ` · ${promptId}` : ""}`;
        }
      });
    }
    else if (next.type === "install_qwen_voice_design") await installQwenVoiceDesignJob(next, { force: next.refs?.force === true });
    else throw new Error(`Unknown job type: ${next.type}`);
    if (next.signal.aborted || next.status === "cancelling") {
      const error = new Error("Generation stopped by director");
      error.code = "GENERATION_CANCELLED";
      throw error;
    }
    if (next.refs?.promptGenerationId) {
      try {
        finalizeAssetPromptAudioGeneration(next.projectSlug, next.refs.promptGenerationId, {
          status: "generated",
          jobId: next.id,
          result: next.result
        });
      } catch (error) {
        console.error("[queue] Could not finalize asset-prompt audio wrapper", error);
      }
    }
    next.status = "done";
    next.stage = "Complete";
    next.progress = 1;
  } catch (e) {
    if (e?.code === "QUEUE_YIELD") {
      next.status = "queued";
      next.stage = "Waiting behind editor export";
      next.error = null;
      return;
    }
    const cancelled = e?.code === "GENERATION_CANCELLED" || next.signal?.aborted || next.status === "cancelling";
    next.status = cancelled ? "cancelled" : "error";
    next.stage = cancelled ? "Stopped" : "Failed";
    next.error = cancelled ? null : String(e.message || e);
    if (next.type === "generate_storyboard_frame") {
      try {
        if (cancelled) restoreStoryboardFrameAfterCancellation(next.projectSlug, next.refs?.frameId);
        else markStoryboardFrameGenerationFailed(next.projectSlug, next.refs?.frameId, e);
      } catch {}
    }
    if (next.type === "generate_storyboard_video_plan") {
      try {
        if (cancelled) restoreStoryboardVideoPlanAfterCancellation(next.projectSlug, next.refs?.videoPlanId);
        else markStoryboardVideoPlanGenerationFailed(next.projectSlug, next.refs?.videoPlanId, e);
      } catch {}
    }
    if (next.type === "generate_prompt_asset") {
      try {
        if (cancelled) restorePromptGenerationAfterCancellation(next.projectSlug, next.refs?.generationId);
        else markPromptGenerationFailed(next.projectSlug, next.refs?.generationId, e);
      } catch {}
    }
    if (next.type === "generate_audio_workflow") {
      const generationIds = Array.isArray(next.generationIds) ? next.generationIds : next.refs?.generationIds || [];
      for (const generationId of generationIds) {
        try {
          if (cancelled) markAudioGenerationCancelled(next.projectSlug, generationId);
          else markAudioGenerationFailed(next.projectSlug, generationId, e);
        } catch {}
      }
    }
    if (next.refs?.promptGenerationId) {
      try {
        finalizeAssetPromptAudioGeneration(next.projectSlug, next.refs.promptGenerationId, {
          status: cancelled ? "cancelled" : "failed",
          jobId: next.id,
          error: e
        });
      } catch {}
    }
    if (!cancelled) console.error("[queue]", next.label, e);
  } finally {
    if (COMFY_PROMPT_JOB_TYPES.has(next.type)) {
      if (gpuLeaseStatus()?.owner === GPU_RESOURCE_OWNERS.COMFYUI) {
        updateGpuLease(GPU_RESOURCE_OWNERS.COMFYUI, {
          jobId: null,
          workerPid: null,
          state: "resident-idle"
        });
      }
    }
    next.finishedAt = next.status === "queued" ? null : new Date().toISOString();
    if (next.type === "build_edit_master" && next.status !== "queued") {
      try { delete next.sequenceSnapshot; } catch {}
    }
    persistJobLedger(next.projectSlug);
    activeJob = null;
    activeAbortController = null;
    running = false;
    setImmediate(pump);
  }
}

async function unloadLocalGpuOwner(owner) {
  if (owner === GPU_RESOURCE_OWNERS.INDEX_TTS) {
    await unloadIndexTtsModel({ timeoutMs: 10_000 });
    return;
  }
  if (owner === GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN) {
    await unloadQwenVoiceDesign({ timeoutMs: 15_000 });
    return;
  }
  if (owner === GPU_RESOURCE_OWNERS.QWEN_TTS) {
    await unloadQwenTtsModel({ timeoutMs: 15_000 });
  }
}

function comfyLeaseHasActiveWork(lease = gpuLeaseStatus()) {
  return Boolean(
    lease?.owner === GPU_RESOURCE_OWNERS.COMFYUI
    && (lease.jobId || !["resident-idle", "idle"].includes(String(lease.state || "")))
  );
}

const BYTES_PER_MIB = 1024 * 1024;
const BYTES_PER_GIB = 1024 * BYTES_PER_MIB;

export function qwenTtsMinimumFreeVramBytes(env = process.env) {
  const explicitBytes = Number(env.QWEN_TTS_MIN_FREE_VRAM_BYTES);
  if (Number.isFinite(explicitBytes) && explicitBytes > 0) return Math.trunc(explicitBytes);
  const configuredGib = Number(env.QWEN_TTS_MIN_FREE_VRAM_GIB);
  const gib = Number.isFinite(configuredGib) && configuredGib > 0 ? configuredGib : 8;
  return Math.trunc(gib * BYTES_PER_GIB);
}

function qwenCudaDeviceIndex(env = process.env) {
  const match = String(env.QWEN_TTS_DEVICE || "cuda:0").match(/(?:cuda:)?(\d+)/i);
  return Math.max(0, Number.parseInt(match?.[1] || "0", 10) || 0);
}

export async function queryNvidiaGpuMemory(options = {}) {
  const env = options.env || process.env;
  const executable = String(env.NVIDIA_SMI_PATH || "nvidia-smi").trim() || "nvidia-smi";
  const index = options.deviceIndex ?? qwenCudaDeviceIndex(env);
  const stdout = await new Promise((resolve, reject) => {
    execFile(executable, [
      "-i", String(index),
      "--query-gpu=index,memory.free,memory.total",
      "--format=csv,noheader,nounits"
    ], {
      windowsHide: true,
      timeout: Math.max(1_000, Number(options.timeoutMs) || 5_000),
      maxBuffer: 64 * 1024,
      env
    }, (error, output) => {
      if (error) return reject(error);
      resolve(String(output || ""));
    });
  });
  const fields = stdout.trim().split(/\r?\n/)[0]?.split(",").map((value) => value.trim()) || [];
  const reportedIndex = Number.parseInt(fields[0], 10);
  const freeMiB = Number(fields[1]);
  const totalMiB = Number(fields[2]);
  if (!Number.isInteger(reportedIndex) || !Number.isFinite(freeMiB) || !Number.isFinite(totalMiB) || freeMiB < 0 || totalMiB <= 0) {
    throw new Error(`Could not parse nvidia-smi memory output: ${stdout.trim() || "empty output"}`);
  }
  return {
    source: "nvidia-smi",
    deviceIndex: reportedIndex,
    freeMiB,
    totalMiB,
    freeBytes: Math.trunc(freeMiB * BYTES_PER_MIB),
    totalBytes: Math.trunc(totalMiB * BYTES_PER_MIB)
  };
}

export async function prepareStandaloneQwenTtsRuntime(options = {}) {
  const job = options.job || {
    signal: options.signal || null,
    stage: "Preparing standalone Qwen3-TTS"
  };
  if (job.signal?.aborted) {
    throw Object.assign(new Error("Qwen3-TTS load cancelled"), { code: "GENERATION_CANCELLED" });
  }

  const owner = GPU_RESOURCE_OWNERS.QWEN_TTS;
  let existing = gpuLeaseStatus();
  const idleComfyLease = existing?.owner === GPU_RESOURCE_OWNERS.COMFYUI
    && ["resident-idle", "idle"].includes(String(existing.state || "").toLowerCase())
    && !existing.jobId;
  if (idleComfyLease) {
    releaseGpuLease(GPU_RESOURCE_OWNERS.COMFYUI);
    existing = null;
  } else if (existing?.owner === GPU_RESOURCE_OWNERS.COMFYUI) {
    const error = new Error("GPU is reserved by ComfyUI. Release that runtime before loading standalone Qwen3-TTS; this provider will not call ComfyUI or port 8188.");
    error.code = "GPU_LEASE_BUSY";
    error.statusCode = 409;
    error.lease = existing;
    throw error;
  }
  if (existing?.owner && existing.owner !== owner) {
    job.stage = `Unloading ${existing.label || existing.owner}`;
    await unloadLocalGpuOwner(existing.owner);
  }
  if (job.signal?.aborted) {
    throw Object.assign(new Error("Qwen3-TTS load cancelled"), { code: "GENERATION_CANCELLED" });
  }
  const remaining = gpuLeaseStatus();
  if (remaining?.owner && remaining.owner !== owner) {
    const error = new Error(`GPU is still reserved by ${remaining.label || remaining.owner}`);
    error.code = "GPU_LEASE_BUSY";
    error.statusCode = 409;
    error.lease = remaining;
    throw error;
  }
  let gpuMemory = null;
  const minimumFreeVramBytes = qwenTtsMinimumFreeVramBytes(options.env || process.env);
  if (!remaining?.owner) {
    job.stage = "Checking local GPU memory for standalone Qwen3-TTS";
    const queryGpuMemory = typeof options.queryGpuMemory === "function"
      ? options.queryGpuMemory
      : () => queryNvidiaGpuMemory({ env: options.env || process.env });
    try {
      gpuMemory = await queryGpuMemory();
    } catch (cause) {
      const error = new Error(`Cannot verify safe free VRAM for standalone Qwen3-TTS: ${String(cause?.message || cause)}`);
      error.code = "GPU_MEMORY_UNKNOWN";
      error.statusCode = 503;
      throw error;
    }
    if (!(Number(gpuMemory?.freeBytes) >= minimumFreeVramBytes)) {
      const availableGib = Number(gpuMemory?.freeBytes || 0) / BYTES_PER_GIB;
      const requiredGib = minimumFreeVramBytes / BYTES_PER_GIB;
      const error = new Error(`Standalone Qwen3-TTS requires ${requiredGib.toFixed(1)} GiB free VRAM; nvidia-smi reports ${availableGib.toFixed(1)} GiB.`);
      error.code = "GPU_VRAM_LOW";
      error.statusCode = 409;
      error.gpuMemory = gpuMemory;
      error.minimumFreeVramBytes = minimumFreeVramBytes;
      throw error;
    }
    acquireGpuLease(owner, {
      label: "Qwen3-TTS Base",
      jobId: options.job?.id || null,
      state: options.job ? "reserved-for-generation" : "reserved-for-load"
    });
  } else if (remaining.owner === owner) {
    updateGpuLease(owner, {
      jobId: options.job?.id || null,
      state: options.job ? "reserved-for-generation" : "reserved-for-load"
    });
  }
  return {
    ready: true,
    owner,
    lease: gpuLeaseStatus(),
    usesComfyUi: false,
    gpuMemory,
    minimumFreeVramBytes
  };
}

export async function prepareLocalGpuRuntime(owner, options = {}) {
  const job = options.job || {
    signal: options.signal || null,
    stage: "Preparing local voice engine"
  };
  if (![GPU_RESOURCE_OWNERS.INDEX_TTS, GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN].includes(owner)) {
    throw new Error(`Unsupported local GPU owner: ${owner}`);
  }
  const sharedGpu = await waitForSharedGpu(job);
  if (job.signal?.aborted) throw Object.assign(new Error("Local voice-engine load cancelled"), { code: "GENERATION_CANCELLED" });

  const existing = gpuLeaseStatus();
  if (existing?.owner && existing.owner !== owner && existing.owner !== GPU_RESOURCE_OWNERS.COMFYUI) {
    job.stage = `Unloading ${existing.label || existing.owner}`;
    await unloadLocalGpuOwner(existing.owner);
  }

  if (sharedGpu.comfyAvailable) {
    job.stage = "Releasing idle ComfyUI models";
    try {
      await releaseComfyGpuMemory();
    } catch (error) {
      const offline = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND"].includes(String(error?.cause?.code || ""))
        || /fetch failed/i.test(String(error?.message || ""));
      if (!offline || comfyLeaseHasActiveWork()) throw error;
      job.stage = "ComfyUI went offline; continuing with the standalone voice engine";
    }
  } else {
    job.stage = "ComfyUI is offline; no shared models need releasing";
  }
  if (gpuLeaseStatus()?.owner === GPU_RESOURCE_OWNERS.COMFYUI) releaseGpuLease(GPU_RESOURCE_OWNERS.COMFYUI);

  const remaining = gpuLeaseStatus();
  if (remaining?.owner && remaining.owner !== owner) {
    const error = new Error(`GPU is still reserved by ${remaining.label || remaining.owner}`);
    error.code = "GPU_LEASE_BUSY";
    error.statusCode = 409;
    error.lease = remaining;
    throw error;
  }
  if (remaining?.owner === owner) {
    updateGpuLease(owner, {
      jobId: options.job?.id || null,
      state: options.job ? "reserved-for-generation" : "reserved-for-load"
    });
  }
  return { ready: true, owner, lease: gpuLeaseStatus() };
}

async function prepareGpuForComfy(job) {
  await waitForSharedGpu(job);
  const existing = gpuLeaseStatus();
  if (existing?.owner && existing.owner !== GPU_RESOURCE_OWNERS.COMFYUI) {
    job.stage = `Unloading ${existing.label || existing.owner}`;
    await unloadLocalGpuOwner(existing.owner);
  }
  acquireGpuLease(GPU_RESOURCE_OWNERS.COMFYUI, {
    label: "ComfyUI / BlokeyUI",
    jobId: job.id,
    state: "generating"
  });
}

async function waitForSharedGpu(job) {
  let consecutiveFailures = 0;
  while (!job.signal?.aborted) {
    let queue;
    try {
      queue = await getComfyQueueState();
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      const definitelyOffline = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND"].includes(String(error?.cause?.code || ""))
        || /fetch failed/i.test(String(error?.message || ""));
      if (definitelyOffline && !comfyLeaseHasActiveWork()) {
        return { comfyAvailable: false, error: String(error.message || error) };
      }
      job.stage = `Waiting for ComfyUI · ${String(error.message || error)}`;
      if (consecutiveFailures >= 10) throw new Error(`ComfyUI remained unavailable while waiting for the shared GPU: ${String(error.message || error)}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    if (!queue.running && !queue.pending) return { comfyAvailable: true, queue };
    job.stage = `Waiting for shared GPU · ${queue.running} running · ${queue.pending} queued`;
    if (jobs.some((candidate) => candidate.status === "queued" && LOCAL_PRIORITY_JOB_TYPES.has(candidate.type))) {
      const error = new Error("Yielding the project queue to an editor export");
      error.code = "QUEUE_YIELD";
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw Object.assign(new Error("Generation stopped while waiting for the shared GPU"), { code: "GENERATION_CANCELLED" });
}

async function runAndFetch(job, prompt, destDir, destName) {
  const outputs = await runPrompt(prompt, {
    signal: job.signal,
    onProgress: ({ value, max }) => {
      if (max) job.progress = Math.min(0.86, 0.08 + (value / max) * 0.78);
    }
  });
  const refs = collectOutputFiles(outputs);
  if (!refs.length) throw new Error("ComfyUI finished with no output files");
  fs.mkdirSync(destDir, { recursive: true });
  const saved = [];
  for (const ref of refs) {
    const name = await downloadOutput(ref, destDir, destName && refs.length === 1 ? destName : null);
    saved.push(name);
  }
  return saved;
}

function clipTotalFrames(project, clip) {
  return framesOf(clip.durationSec || project.settings.defaultDurationSec || 6, project.settings.fps || 24);
}

function nextVersion(items = []) {
  return Math.max(0, ...items.map((x) => Number(x.v) || 0)) + 1;
}

export function sequenceClipChapterFolder(clip) {
  for (const value of [clip?.chapterId, clip?.sceneId, clip?.id, clip?.name]) {
    const match = String(value || "").match(/(?:^|[^a-z0-9])((?:H|MV)\d{2})(?=$|[^a-z0-9])/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

export function sequenceClipStoredFile(clip, fileName) {
  const name = path.basename(String(fileName || ""));
  if (!name) throw new Error("Clip media filename is required");
  const chapter = sequenceClipChapterFolder(clip);
  return chapter ? `${chapter}/${name}` : name;
}

function normalizeStoredClipFile(value) {
  const relative = String(value || "")
    .replaceAll("\\", "/")
    .replace(/^media\/clips\//i, "")
    .replace(/^\/+/, "");
  if (
    !relative
    || relative.split("/").some((part) => !part || part === "." || part === "..")
    || !/^(?:(?:H|MV)\d{2}\/)?[^/]+$/i.test(relative)
  ) {
    throw new Error(`Invalid project clip media path: ${value || "missing"}`);
  }
  return relative;
}

function clipMediaDisk(project, storedFile) {
  const root = path.resolve(mediaDir(project, "clips"));
  const relative = normalizeStoredClipFile(storedFile);
  const disk = path.resolve(root, ...relative.split("/"));
  if (!disk.startsWith(`${root}${path.sep}`)) throw new Error("Project clip media escaped its library root");
  return disk;
}

function clipOutputDirectory(project, clip) {
  const chapter = sequenceClipChapterFolder(clip);
  return chapter ? path.join(mediaDir(project, "clips"), chapter) : mediaDir(project, "clips");
}

function clipComfyOutputPrefix(project, clip, baseName) {
  const chapter = sequenceClipChapterFolder(clip);
  return `premiere316/${project.slug}/${chapter ? `${chapter}/` : ""}${baseName}`;
}

function currentGuideBindings(project, clip) {
  const firstGuide = (clip.guides || []).find((guide) => guide.role === "first" || Number(guide.frame) === 0);
  if (!firstGuide?.file) throw new Error("Clip has no approved first-frame guide");
  const files = [...new Set([
    ...(clip.guides || []).map((guide) => guide.file),
    clip.firstFrame?.file,
    clip.endFrame?.file
  ].filter(Boolean))].sort();
  return files.map((file) => {
    const frame = (project.frames || []).find((item) => item.file === file);
    const asset = project.assets?.items?.find((item) => item.id === frame?.assetId);
    if (!frame) throw new Error(`Render cancelled because guide media is missing: ${file}`);
    if (!skipApproval(project) && (
      frame.source !== "asset-foundry-approved" ||
      !asset ||
      !assetApprovalCurrent(project, asset) ||
      Number(frame.assetVersion) !== Number(asset.activeVersion) ||
      frame.assetApprovalFingerprint !== asset.approval?.versionFingerprint ||
      frame.screenplayRevision !== asset.approval?.screenplayRevision
    )) throw new Error(`Render cancelled because guide media is missing, stale, or no longer approved: ${frame?.name || file}`);
    return {
      file,
      frameId: frame.id,
      assetId: frame.assetId,
      assetVersion: Number(frame.assetVersion),
      approvalFingerprint: frame.assetApprovalFingerprint,
      screenplayRevision: frame.screenplayRevision
    };
  });
}

function renderFingerprint(project, clip) {
  return crypto.createHash("sha256").update(JSON.stringify({
    clipId: clip.id,
    name: clip.name,
    durationSec: clip.durationSec,
    globalPrompt: clip.globalPrompt || "",
    seed: clip.seed ?? null,
    segments: (clip.segments || []).map((segment) => ({
      id: segment.id,
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
      prompt: segment.prompt || ""
    })),
    settings: {
      fps: project.settings?.fps,
      width: project.settings?.width,
      height: project.settings?.height,
      ingredients: project.settings?.ingredients || null
    }
  })).digest("hex");
}

function validateQueuedRender(project, clip, refs) {
  if (!refs?.clipFingerprint || refs.clipFingerprint !== renderFingerprint(project, clip)) {
    throw new Error("Render cancelled because the clip direction or generation settings changed after it was queued");
  }
  const current = currentGuideBindings(project, clip);
  if (JSON.stringify(current) !== JSON.stringify(refs.guideBindings || [])) {
    throw new Error("Render cancelled because its approved guide versions changed after it was queued");
  }
}

function validateQueuedClipFingerprint(project, clip, refs) {
  if (!refs?.clipFingerprint || refs.clipFingerprint !== renderFingerprint(project, clip)) {
    throw new Error("Render cancelled because the clip direction or generation settings changed after it was queued");
  }
}

async function uploadClipGuides(project, clip) {
  const subfolder = `premiere316/${project.slug}`;
  const uploaded = new Map();
  const out = [];
  for (const guide of clip.guides || []) {
    const disk = path.join(mediaDir(project, "frames"), guide.file);
    if (!fs.existsSync(disk)) continue;
    let comfyFile = uploaded.get(guide.file);
    if (!comfyFile) {
      comfyFile = await uploadImage(disk, subfolder);
      uploaded.set(guide.file, comfyFile);
    }
    out.push({ ...guide, comfyFile });
  }
  return out;
}

function assetVisualFile(asset, requestedVersion) {
  const versionNumber = Number(requestedVersion ?? asset?.activeVersion);
  const versions = Array.isArray(asset?.versions) ? asset.versions : [];
  const version = versions.find((item) => Number(item.v) === versionNumber) || versions.at(-1);
  if (!version) return null;
  return version.file || (Array.isArray(version.files) ? version.files.find((file) => /\.(png|jpe?g|webp)$/i.test(String(file || ""))) : null);
}

function h3ReferenceDisk(project, reference) {
  const storedFile = reference?.file || reference?.sourceAssetFile || null;
  if (storedFile) {
    for (const kind of ["assets", "frames"]) {
      const disk = path.resolve(mediaDir(project, kind), path.basename(storedFile));
      if (fs.existsSync(disk)) return { disk, file: path.basename(storedFile) };
    }
  }
  if (!reference?.assetId) throw new Error(`MiniMax H3 reference ${reference?.id || reference?.display || "item"} has no asset binding or file`);
  const asset = (project.assets?.items || []).find((item) => item.id === reference.assetId);
  if (!asset) throw new Error(`MiniMax H3 reference asset is missing: ${reference.assetId}`);
  const requestedVersion = Number(reference.assetVersion ?? asset.activeVersion);
  if (!skipApproval(project) && (!assetApprovalCurrent(project, asset) || Number(asset.approval?.activeVersion) !== requestedVersion)) {
    throw new Error(`MiniMax H3 reference ${asset.name || asset.id} must use its currently approved active version.`);
  }
  const file = assetVisualFile(asset, requestedVersion);
  if (!file) throw new Error(`MiniMax H3 reference ${asset.name || asset.id} has no image file for v${reference.assetVersion || asset.activeVersion || "active"}`);
  const disk = path.resolve(mediaDir(project, "assets"), path.basename(file));
  if (!fs.existsSync(disk)) throw new Error(`MiniMax H3 reference file is missing on disk: ${file}`);
  return { disk, file: path.basename(file), asset };
}

async function uploadH3References(project, references = []) {
  const subfolder = `premiere316/${project.slug}/h3`;
  const uploaded = new Map();
  const out = [];
  for (const [index, reference] of (Array.isArray(references) ? references : []).entries()) {
    if (reference?.comfyFile) {
      out.push({ ...reference, type: String(reference.type || "image").toLowerCase(), comfyFile: reference.comfyFile });
      continue;
    }
    if (String(reference?.type || "image").toLowerCase() !== "image") {
      throw new Error(`MiniMax H3 reference ${reference?.id || reference?.display || index + 1} must be pre-staged as a ComfyUI file unless it is an image asset.`);
    }
    const { disk, file, asset } = h3ReferenceDisk(project, reference);
    let comfyFile = uploaded.get(disk);
    if (!comfyFile) {
      comfyFile = await uploadImage(disk, subfolder);
      uploaded.set(disk, comfyFile);
    }
    out.push({
      ...reference,
      id: reference.id || reference.assetId || `h3_ref_${index + 1}`,
      type: String(reference.type || "image").toLowerCase(),
      role: reference.role || asset?.category || "reference",
      file,
      comfyFile
    });
  }
  return out;
}

async function renderRange(job) {
  const project = loadProject(job.projectSlug);
  const clip = findClip(project, job.refs.clipId);
  if (!clip) throw new Error("Clip not found");
  validateQueuedRender(project, clip, job.refs);

  const fps = project.settings.fps || 24;
  const totalFrames = clipTotalFrames(project, clip);
  const rangeStartFrame = Math.max(0, Math.min(totalFrames - 1, Number(job.refs.startFrame) || 0));
  const rangeEndFrame = Math.max(
    rangeStartFrame + 1,
    Math.min(totalFrames, Number(job.refs.endFrame) || totalFrames)
  );
  const version = nextVersion(clip.rangeVersions || []);
  const baseName = `${clip.name}_r${String(rangeStartFrame).padStart(5, "0")}-${String(rangeEndFrame).padStart(5, "0")}_v${String(version).padStart(2, "0")}`;
  job.label = `Render ${clip.name} · ${rangeStartFrame}–${rangeEndFrame}f`;
  job.stage = "Uploading guides";
  job.progress = 0.04;

  const guides = await uploadClipGuides(project, clip);
  const durationSec = clampDuration(clip.durationSec || project.settings.defaultDurationSec || 6);
  job.stage = "Compiling LTX Director prompt";
  const compiled = await fillI2vPrompt({
    globalPrompt: clip.globalPrompt || "",
    segments: clip.segments || [],
    guides,
    rangeStartFrame,
    rangeEndFrame,
    durationSec,
    fps,
    width: project.settings.width || 1280,
    height: project.settings.height || 720,
    seed: clip.seed,
    ingredients: project.settings.ingredients,
    filenamePrefix: clipComfyOutputPrefix(project, clip, baseName),
    objectInfo: await getObjectInfo()
  });
  if (compiled.warnings?.length) console.warn("[render_range] conversion warnings:", compiled.warnings);

  job.stage = "Generating in ComfyUI";
  const outputDir = clipOutputDirectory(project, clip);
  const files = await runAndFetch(job, compiled.prompt, outputDir, baseName);
  const videoName = files.find((f) => /\.(mp4|webm|mov|mkv)$/i.test(f));
  if (!videoName) throw new Error("ComfyUI returned files, but none was a video");

  job.stage = "Trimming to selected range";
  job.progress = 0.9;
  const inputPath = path.join(outputDir, videoName);
  const trimmedName = `${baseName}_exact.mp4`;
  const trimmedPath = path.join(outputDir, trimmedName);
  const trimmedFile = sequenceClipStoredFile(clip, trimmedName);
  await trimVideoToFrames(inputPath, trimmedPath, compiled.requestedFrames, fps);
  if (path.resolve(inputPath) !== path.resolve(trimmedPath)) {
    try { fs.unlinkSync(inputPath); } catch {}
  }

  const fresh = loadProject(project.slug);
  const freshClip = findClip(fresh, clip.id);
  if (!freshClip) throw new Error("Clip disappeared while rendering");
  validateQueuedRender(fresh, freshClip, job.refs);
  if (nextVersion(freshClip.rangeVersions || []) !== version) {
    throw new Error("Render output was retained but not registered because another clip version completed during generation");
  }

  const rangeVersion = {
    v: version,
    file: trimmedFile,
    name: baseName,
    startFrame: compiled.rangeStartFrame,
    endFrame: compiled.rangeEndFrame,
    requestedFrames: compiled.requestedFrames,
    generationFrames: compiled.generationFrames,
    segmentIds: job.refs.segmentIds || [],
    active: true,
    createdAt: new Date().toISOString()
  };
  freshClip.rangeVersions = freshClip.rangeVersions || [];
  for (const old of freshClip.rangeVersions) {
    if (old.startFrame === rangeVersion.startFrame && old.endFrame === rangeVersion.endFrame) old.active = false;
  }
  freshClip.rangeVersions.push(rangeVersion);

  const selected = new Set(job.refs.segmentIds || []);
  for (const segment of freshClip.segments || []) {
    if (selected.has(segment.id) || (segment.startFrame >= rangeStartFrame && segment.endFrame <= rangeEndFrame)) {
      segment.dirty = false;
    }
  }

  if (rangeStartFrame === 0 && rangeEndFrame === totalFrames) {
    const fullVersion = nextVersion(freshClip.versions || []);
    freshClip.versions = freshClip.versions || [];
    freshClip.versions.push({
      v: fullVersion,
      file: trimmedFile,
      name: `${freshClip.name}_v${String(fullVersion).padStart(2, "0")}`,
      createdAt: new Date().toISOString(),
      source: "full-range-render",
      requestedFrames: compiled.requestedFrames,
      generationFrames: compiled.generationFrames
    });
    freshClip.activeVersion = fullVersion;
    freshClip.status = "done";
  } else {
    freshClip.status = (freshClip.segments || []).every((s) => s.dirty === false) ? "ranges-ready" : "partial";
  }
  saveProject(fresh);
  job.result = { clipId: freshClip.id, rangeVersion, file: trimmedFile };
  job.progress = 0.98;
}

function h3ModeInfo(mode) {
  return H3_MODES[mode] || H3_MODES[H3_MODE_FIRST];
}

function h3AnchorsForRange(guides, mode, rangeStartFrame, rangeEndFrame, totalFrames) {
  const info = h3ModeInfo(mode);
  const sorted = (guides || [])
    .filter((guide) => guide?.comfyFile)
    .map((guide) => ({ ...guide, frame: Math.max(0, Math.round(Number(guide.frame) || 0)) }))
    .sort((a, b) => a.frame - b.frame);
  const first =
    sorted.filter((guide) => guide.frame <= rangeStartFrame).at(-1) ||
    sorted.find((guide) => guide.role === "first" || guide.frame === 0) ||
    sorted[0] ||
    null;
  const explicitLast = sorted.find((guide) => guide.role === "last" || guide.frame >= totalFrames - 1) || null;
  const afterRange = sorted.find((guide) => guide.frame >= Math.max(rangeStartFrame, rangeEndFrame - 1)) || null;
  const last = info.needsLast
    ? (afterRange || explicitLast)
    : (afterRange || explicitLast || sorted.at(-1) || null);
  if (info.needsFirst && !first?.comfyFile) throw new Error(`${info.label} needs an approved first-frame guide.`);
  if (info.needsLast && !last?.comfyFile) throw new Error(`${info.label} needs an approved last-frame guide.`);
  return { first, last };
}

async function renderH3Range(job) {
  const project = loadProject(job.projectSlug);
  const clip = findClip(project, job.refs.clipId);
  if (!clip) throw new Error("Clip not found");
  const mode = job.refs.h3Mode || H3_MODE_FIRST;
  const modeInfo = h3ModeInfo(mode);
  if (modeInfo.needsFirst || modeInfo.needsLast) validateQueuedRender(project, clip, job.refs);
  else validateQueuedClipFingerprint(project, clip, job.refs);

  const projectFps = project.settings.fps || 24;
  const totalFrames = clipTotalFrames(project, clip);
  const rangeStartFrame = Math.max(0, Math.min(totalFrames - 1, Number(job.refs.startFrame) || 0));
  const rangeEndFrame = Math.max(
    rangeStartFrame + 1,
    Math.min(totalFrames, Number(job.refs.endFrame) || totalFrames)
  );
  const requestedSeconds = (rangeEndFrame - rangeStartFrame) / projectFps;
  if (requestedSeconds > 15.001) {
    throw new Error(`${H3_DISPLAY_NAME} jobs must be split to ${15}s or less before queueing; received ${requestedSeconds.toFixed(2)}s.`);
  }
  const version = nextVersion(clip.rangeVersions || []);
  const baseName = `${clip.name}_h3_${String(rangeStartFrame).padStart(5, "0")}-${String(rangeEndFrame).padStart(5, "0")}_v${String(version).padStart(2, "0")}`;
  job.label = `${H3_DISPLAY_NAME} ${clip.name} · ${rangeStartFrame}–${rangeEndFrame}f`;
  job.stage = "Checking MiniMax H3 backend";
  job.progress = 0.03;

  const diagnostics = await h3Diagnostics();
  const modeReady = mode === H3_MODE_REFERENCE ? diagnostics.ref2vaReady : diagnostics.fl2vaReady;
  if (!modeReady) {
    const details = [
      ...(diagnostics.actionableErrors || []),
      ...(mode === H3_MODE_REFERENCE ? diagnostics.warnings || [] : [])
    ].filter(Boolean);
    throw new Error(`${H3_DISPLAY_NAME} ${modeInfo.label} is not ready: ${details.join(" ") || "see diagnostics panel"}`);
  }

  job.stage = "Uploading approved H3 anchors";
  job.progress = 0.06;
  const guides = await uploadClipGuides(project, clip);
  const anchors = h3AnchorsForRange(guides, mode, rangeStartFrame, rangeEndFrame, totalFrames);
  const h3References = await uploadH3References(project, job.refs.references || []);

  const aspect = job.refs.h3Aspect || project.settings?.aspectRatio || `${project.settings.width || 1344}:${project.settings.height || 768}`;
  const dimensions = h3Dimensions({
    aspect,
    width: project.settings.width || 1344,
    height: project.settings.height || 768,
    quality: job.refs.h3Quality || "full"
  });
  const seed = randomH3Seed(job.refs.seed ?? clip.seed);

  job.stage = "Compiling MiniMax H3 prompt";
  job.progress = 0.1;
  const compiled = compileH3Prompt({
    project,
    clip,
    mode,
    rangeStartFrame,
    rangeEndFrame,
    audioMode: job.refs.h3AudioMode || "mixed",
    referenceManifest: h3References
  });
  const objectInfo = await getObjectInfo();
  const workflow = buildH3Workflow({
    objectInfo,
    mode,
    promptText: compiled.prompt,
    width: dimensions.width,
    height: dimensions.height,
    frames: compiled.timing.resolvedFrames,
    seed,
    filenamePrefix: clipComfyOutputPrefix(project, clip, `${baseName}_raw`),
    firstFrameComfyFile: anchors.first?.comfyFile,
    lastFrameComfyFile: anchors.last?.comfyFile,
    references: h3References,
    refImageSize: job.refs.refImageSize || "match"
  });
  if (workflow.warnings?.length) console.warn("[render_h3_range] conversion warnings:", workflow.warnings);

  job.stage = "Generating MiniMax H3 video + native audio";
  const outputDir = clipOutputDirectory(project, clip);
  const rawFiles = await runAndFetch(job, workflow.prompt, outputDir, `${baseName}_raw`);
  const rawVideoName = rawFiles.find((file) => /\.(mp4|webm|mov|mkv)$/i.test(file));
  if (!rawVideoName) throw new Error("ComfyUI returned files, but none was an H3 video");

  job.stage = "Conforming H3 output to timeline range";
  job.progress = 0.9;
  const rawPath = path.join(outputDir, rawVideoName);
  const rawFile = sequenceClipStoredFile(clip, rawVideoName);
  const conformedName = `${baseName}_exact.mp4`;
  const conformedPath = path.join(outputDir, conformedName);
  const conformedFile = sequenceClipStoredFile(clip, conformedName);
  await trimVideoToFrames(rawPath, conformedPath, compiled.timing.conformedFrames, H3_FPS);
  const rawInfo = await probeMedia(rawPath).catch(() => null);
  const conformedInfo = await probeMedia(conformedPath).catch(() => null);

  const fresh = loadProject(project.slug);
  const freshClip = findClip(fresh, clip.id);
  if (!freshClip) throw new Error("Clip disappeared while rendering");
  if (modeInfo.needsFirst || modeInfo.needsLast) validateQueuedRender(fresh, freshClip, job.refs);
  else validateQueuedClipFingerprint(fresh, freshClip, job.refs);
  if (nextVersion(freshClip.rangeVersions || []) !== version) {
    throw new Error("H3 output was retained but not registered because another clip version completed during generation");
  }

  const rangeVersion = {
    v: version,
    file: conformedFile,
    rawFile,
    name: baseName,
    provider: "minimax_h3_local",
    source: "minimax-h3-range-render",
    h3Mode: mode,
    startFrame: compiled.rangeStartFrame,
    endFrame: compiled.rangeEndFrame,
    requestedFrames: rangeEndFrame - rangeStartFrame,
    generationFrames: compiled.timing.resolvedFrames,
    h3Timing: compiled.timing,
    fps: H3_FPS,
    width: dimensions.width,
    height: dimensions.height,
    seed,
    segmentIds: job.refs.segmentIds || [],
    active: true,
    createdAt: new Date().toISOString(),
    prompt: compiled.prompt,
    workflow: {
      sourceTemplate: workflow.sourceTemplate,
      semanticSlots: workflow.semanticSlots,
      modelFiles: {
        diffusion: H3_MODEL_FILES[workflow.family].filename,
        textEncoder: H3_MODEL_FILES.textEncoder.filename,
        videoVae: H3_MODEL_FILES.videoVae.filename,
        audioVae: H3_MODEL_FILES.audioVae.filename
      }
    },
    mediaInfo: {
      raw: rawInfo,
      conformed: conformedInfo
    }
  };
  freshClip.rangeVersions = freshClip.rangeVersions || [];
  for (const old of freshClip.rangeVersions) {
    if (old.startFrame === rangeVersion.startFrame && old.endFrame === rangeVersion.endFrame) old.active = false;
  }
  freshClip.rangeVersions.push(rangeVersion);

  const selected = new Set(job.refs.segmentIds || []);
  for (const segment of freshClip.segments || []) {
    if (selected.has(segment.id) || (segment.startFrame >= rangeStartFrame && segment.endFrame <= rangeEndFrame)) {
      segment.dirty = false;
    }
  }

  if (rangeStartFrame === 0 && rangeEndFrame === totalFrames) {
    const fullVersion = nextVersion(freshClip.versions || []);
    freshClip.versions = freshClip.versions || [];
    freshClip.versions.push({
      v: fullVersion,
      file: conformedFile,
      rawFile,
      name: `${freshClip.name}_h3_v${String(fullVersion).padStart(2, "0")}`,
      createdAt: new Date().toISOString(),
      source: "minimax-h3-full-range-render",
      requestedFrames: rangeEndFrame - rangeStartFrame,
      generationFrames: compiled.timing.resolvedFrames,
      h3Mode: mode,
      fps: H3_FPS,
      width: dimensions.width,
      height: dimensions.height,
      seed
    });
    freshClip.activeVersion = fullVersion;
    freshClip.status = "done";
  } else {
    freshClip.status = (freshClip.segments || []).every((segment) => segment.dirty === false) ? "ranges-ready" : "partial";
  }
  saveProject(fresh);
  job.result = { clipId: freshClip.id, rangeVersion, file: conformedFile, rawFile };
  job.progress = 0.98;
}

function activeClipFile(project, clip) {
  const active = (clip.versions || []).find((v) => Number(v.v) === Number(clip.activeVersion));
  if (!active?.file) return null;
  const disk = clipMediaDisk(project, active.file);
  return fs.existsSync(disk) ? disk : null;
}

function timeOf(item) {
  const value = Date.parse(item?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function activeFullVersion(project, clip) {
  const versions = clip.versions || [];
  const active = versions.find((v) => Number(v.v) === Number(clip.activeVersion)) || versions.at(-1);
  if (!active?.file) return null;
  const file = clipMediaDisk(project, active.file);
  return fs.existsSync(file) ? { ...active, file } : null;
}

function sourcePlanForClip(project, clip) {
  const total = clipTotalFrames(project, clip);
  const full = activeFullVersion(project, clip);
  const fullCreatedAt = timeOf(full);
  const ranges = (clip.rangeVersions || [])
    .filter((r) => r.active !== false && r.file)
    .map((r) => ({
      ...r,
      startFrame: Math.max(0, Math.min(total - 1, Math.round(Number(r.startFrame) || 0))),
      endFrame: Math.max(1, Math.min(total, Math.round(Number(r.endFrame) || total))),
      diskFile: clipMediaDisk(project, r.file)
    }))
    .filter((r) => r.endFrame > r.startFrame && fs.existsSync(r.diskFile))
    // An accepted/assembled full version is the new baseline. Only range renders
    // created after it should override it.
    .filter((r) => !full || timeOf(r) > fullCreatedAt)
    .sort((a, b) => timeOf(b) - timeOf(a) || Number(b.v) - Number(a.v));

  if (!ranges.length) {
    if (full) return [{
      file: full.file,
      startFrame: 0,
      endFrame: total,
      offsetFrame: 0,
      source: "full",
      sourceVersion: full.v
    }];
    throw new Error(`Cannot assemble ${clip.name}: no accepted full render or complete selected-range coverage exists`);
  }

  const boundaries = new Set([0, total]);
  for (const range of ranges) {
    boundaries.add(range.startFrame);
    boundaries.add(range.endFrame);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const startFrame = sorted[i];
    const endFrame = sorted[i + 1];
    if (endFrame <= startFrame) continue;
    const range = ranges.find((r) => r.startFrame <= startFrame && r.endFrame >= endFrame);
    if (range) {
      pieces.push({
        file: range.diskFile,
        startFrame,
        endFrame,
        offsetFrame: startFrame - range.startFrame,
        source: "range",
        sourceVersion: range.v
      });
    } else if (full) {
      pieces.push({
        file: full.file,
        startFrame,
        endFrame,
        offsetFrame: startFrame,
        source: "full",
        sourceVersion: full.v
      });
    } else {
      throw new Error(`Cannot assemble ${clip.name}: selected renders leave a gap at frames ${startFrame}–${endFrame}`);
    }
  }

  // Merge adjacent intervals that read continuously from the same source file.
  return pieces.reduce((merged, piece) => {
    const previous = merged.at(-1);
    const previousLength = previous ? previous.endFrame - previous.startFrame : 0;
    if (
      previous &&
      previous.file === piece.file &&
      previous.endFrame === piece.startFrame &&
      previous.offsetFrame + previousLength === piece.offsetFrame
    ) {
      previous.endFrame = piece.endFrame;
      return merged;
    }
    merged.push({ ...piece });
    return merged;
  }, []);
}

async function assembleClipFile(project, clip, job = null) {
  const fps = project.settings.fps || 24;
  const totalFrames = clipTotalFrames(project, clip);
  const plan = sourcePlanForClip(project, clip);
  const existing = activeClipFile(project, clip);
  if (
    plan.length === 1 &&
    plan[0].startFrame === 0 &&
    plan[0].endFrame === totalFrames &&
    plan[0].offsetFrame === 0 &&
    existing &&
    path.resolve(plan[0].file) === path.resolve(existing)
  ) {
    return existing;
  }

  const version = nextVersion(clip.versions || []);
  const name = `${clip.name}_v${String(version).padStart(2, "0")}.mp4`;
  const storedFile = sequenceClipStoredFile(clip, name);
  const output = clipMediaDisk(project, storedFile);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (job) {
    job.stage = `Assembling ${clip.name}`;
    job.progress = 0.08;
  }
  if (
    plan.length === 1 &&
    plan[0].startFrame === 0 &&
    plan[0].endFrame === totalFrames &&
    plan[0].offsetFrame === 0
  ) {
    fs.copyFileSync(plan[0].file, output);
  } else {
    await concatVideoSegments(plan.map((piece) => ({
      file: piece.file,
      startSec: piece.offsetFrame / fps,
      durationSec: (piece.endFrame - piece.startFrame) / fps
    })), output, {
      width: project.settings.width || 1280,
      height: project.settings.height || 720,
      fps
    }, (p) => {
      if (job) job.progress = 0.1 + p * 0.78;
    });
  }
  clip.versions = clip.versions || [];
  clip.versions.push({
    v: version,
    file: storedFile,
    name: path.parse(name).name,
    createdAt: new Date().toISOString(),
    source: "assembled-ranges",
    sourcePlan: plan.map((piece) => ({
      startFrame: piece.startFrame,
      endFrame: piece.endFrame,
      source: piece.source,
      sourceVersion: piece.sourceVersion
    }))
  });
  clip.activeVersion = version;
  clip.status = "done";
  saveProject(project);
  return output;
}

async function assembleClipJob(job) {
  const project = loadProject(job.projectSlug);
  const clip = findClip(project, job.refs.clipId);
  if (!clip) throw new Error("Clip not found");
  job.label = `Assemble ${clip.name}`;
  const file = await assembleClipFile(project, clip, job);
  job.result = {
    clipId: clip.id,
    file: path.relative(mediaDir(project, "clips"), file).replaceAll("\\", "/")
  };
}

async function generateScoreFile(project, job = null) {
  const score = project.score;
  const durationSec = Math.max(1, Number(project.sequence.durationSec) || 1);
  const version = nextVersion(score.versions || []);
  const name = `${project.slug}_score_v${String(version).padStart(2, "0")}.wav`;
  const output = path.join(mediaDir(project, "audio"), name);
  if (job) {
    job.stage = "Generating project score";
    job.progress = 0.2;
  }
  await generatePrototypeScore({
    output,
    durationSec,
    mood: score.mood,
    tempo: score.tempo,
    fadeInSec: score.fadeInSec,
    fadeOutSec: score.fadeOutSec
  });
  score.versions = score.versions || [];
  score.versions.push({
    v: version,
    file: name,
    name: path.parse(name).name,
    createdAt: new Date().toISOString(),
    durationSec,
    source: "prototype-score-generator",
    prompt: score.prompt
  });
  score.activeVersion = version;
  saveProject(project);
  return output;
}

async function generateScore(job) {
  const project = loadProject(job.projectSlug);
  job.label = `Generate score · ${project.name}`;
  const output = await generateScoreFile(project, job);
  job.result = { file: path.basename(output), version: project.score.activeVersion };
}

function activeScoreFile(project) {
  const score = project.score || {};
  const active = (score.versions || []).find((v) => Number(v.v) === Number(score.activeVersion));
  if (!active?.file) return null;
  const disk = path.join(mediaDir(project, "audio"), active.file);
  return fs.existsSync(disk) ? disk : null;
}

async function buildMaster(job) {
  const project = loadProject(job.projectSlug);
  if (!project.sequence.clips.length) throw new Error("Add at least one clip before building a master");
  const bookends = normalizeBookends(job.refs?.bookends || project.settings?.bookends, project.name);
  project.settings.bookends = bookends;
  job.label = `Build final master · ${project.name}`;
  job.stage = "Resolving active clip versions";
  const clipFiles = [];
  for (let i = 0; i < project.sequence.clips.length; i++) {
    const clip = project.sequence.clips[i];
    const file = await assembleClipFile(project, clip, null);
    clipFiles.push(file);
    job.progress = 0.05 + ((i + 1) / project.sequence.clips.length) * 0.15;
  }

  const masterVersion = nextVersion(project.masters || []);
  const base = `${project.slug}_master_v${String(masterVersion).padStart(2, "0")}`;
  const pictureName = `${base}_picture.mp4`;
  const picture = path.join(mediaDir(project, "masters"), pictureName);
  job.stage = "Stitching core sequence";
  await concatVideos(clipFiles, picture, {
    width: project.settings.width || 1280,
    height: project.settings.height || 720,
    fps: project.settings.fps || 24
  }, (p) => { job.progress = 0.2 + p * 0.36; });
  const coreInfo = await probeMedia(picture);
  const coreDurationSec = Number(coreInfo.video?.duration) || Number(coreInfo.durationSec) || 0;
  const expectedMasterDurationSec = coreDurationSec + bookendDurationSec(bookends, project.name);

  let coreFile = picture;
  let scoreVersion = 0;
  if (project.score?.enabled) {
    job.stage = "Preparing musical score";
    let scoreFile = activeScoreFile(project);
    if (!scoreFile && project.score.mode !== "none") {
      scoreFile = await generateScoreFile(project, null);
    }
    if (scoreFile) {
      scoreVersion = project.score.activeVersion;
      const mixedName = `${base}_scored.mp4`;
      const mixed = path.join(mediaDir(project, "masters"), mixedName);
      job.stage = "Mixing score into the core film";
      job.progress = 0.64;
      await mixScore(picture, scoreFile, mixed, project.score);
      coreFile = mixed;
    }
  }

  const finalName = `${base}.mp4`;
  const finalPath = path.join(mediaDir(project, "masters"), finalName);
  const hasBookends = bookends.opening.enabled || bookends.credits.enabled;
  let bookendTemp = null;
  let finalReady = false;
  try {
    if (hasBookends) {
      bookendTemp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-master-bookends-"));
      const finalPieces = [];
      if (bookends.opening.enabled) {
        job.stage = `Typesetting ${BOOKEND_OPENING_TITLE}`;
        job.progress = 0.76;
        const openingFile = path.join(bookendTemp, "opening.mp4");
        await renderMasterBookend({
          kind: "opening",
          output: openingFile,
          width: project.settings.width,
          height: project.settings.height,
          fps: project.settings.fps
        });
        finalPieces.push(openingFile);
      }
      finalPieces.push(coreFile);
      if (bookends.credits.enabled) {
        job.stage = "Typesetting 30-second end credits";
        job.progress = bookends.opening.enabled ? 0.84 : 0.79;
        const creditsFile = path.join(bookendTemp, "credits.mp4");
        await renderMasterBookend({
          kind: "credits",
          output: creditsFile,
          text: bookends.credits.text,
          width: project.settings.width,
          height: project.settings.height,
          fps: project.settings.fps
        });
        finalPieces.push(creditsFile);
      }
      job.stage = "Appending deterministic master bookends";
      job.progress = 0.9;
      try {
        await concatPreparedVideos(finalPieces, finalPath, expectedMasterDurationSec);
      } catch (copyError) {
        console.warn("[queue] prepared master concat needed compatibility normalization:", copyError.message);
        job.stage = "Normalizing final master compatibility";
        const compatibilityFile = path.join(bookendTemp, "compatibility-joined.mp4");
        await concatVideos(finalPieces, compatibilityFile, {
          width: project.settings.width || 1280,
          height: project.settings.height || 720,
          fps: project.settings.fps || 24
        }, (p) => { job.progress = 0.9 + p * 0.06; });
        await finalizeMasterMedia(compatibilityFile, finalPath, expectedMasterDurationSec);
      }
    } else {
      fs.copyFileSync(coreFile, finalPath);
    }
    finalReady = true;
  } finally {
    if (bookendTemp) fs.rmSync(bookendTemp, { recursive: true, force: true });
    for (const intermediate of new Set([picture, coreFile])) {
      if (path.resolve(intermediate) === path.resolve(finalPath)) continue;
      try { if (fs.existsSync(intermediate)) fs.unlinkSync(intermediate); } catch {}
    }
    if (!finalReady) {
      try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
    }
  }
  const info = await probeMedia(finalPath);
  const creditsHash = crypto.createHash("sha256").update(bookends.credits.text).digest("hex");
  project.masters = project.masters || [];
  project.masters.push({
    v: masterVersion,
    file: path.basename(finalPath),
    name: base,
    createdAt: new Date().toISOString(),
    durationSec: info.durationSec,
    coreDurationSec,
    expectedDurationSec: expectedMasterDurationSec,
    scoreVersion,
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    bookends: {
      opening: {
        enabled: bookends.opening.enabled,
        durationSec: BOOKEND_DURATION_SEC,
        title: BOOKEND_OPENING_TITLE
      },
      credits: {
        enabled: bookends.credits.enabled,
        durationSec: BOOKEND_DURATION_SEC,
        text: bookends.credits.text,
        textSha256: creditsHash
      }
    }
  });
  project.activeMasterVersion = masterVersion;
  saveProject(project);
  job.result = {
    file: path.basename(finalPath),
    version: masterVersion,
    bookendDurationSec: bookendDurationSec(bookends, project.name)
  };
  job.progress = 0.98;
}
