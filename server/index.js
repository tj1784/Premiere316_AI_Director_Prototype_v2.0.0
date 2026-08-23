// Premiere316 — AI video-generation timeline over ComfyUI / LTX Director.
import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import http from "node:http";
import https from "node:https";
import multer from "multer";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { Readable } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { comfyAlive, COMFY_URL, getComfyQueueState, getComfySystemStats, getObjectInfo } from "./comfy.js";
import {
  isBundledComfyUrl,
  managedComfyProfile,
  normalizeComfyUrl,
  saveConfiguredComfyUrl
} from "./comfy-config.js";
import {
  listProjects,
  createProject,
  loadProject,
  saveProject,
  deleteProject,
  makeClip,
  registerFrame,
  recomputeStarts,
  findClip,
  findGuide,
  mediaDir,
  ensureDirs,
  syncGuideAliases,
  skipApproval,
  skipScreenplay,
  isShortsProject,
  normalizeProjectCategory
} from "./projects.js";
import {
  enqueue,
  listJobs,
  cancelJob,
  cancelAssetJobs,
  prepareLocalGpuRuntime,
  prepareStandaloneQwenTtsRuntime
} from "./queue.js";
import { gpuLeaseStatus, GPU_RESOURCE_OWNERS } from "./gpu-resource-manager.js";
import {
  bindIndexTtsGenerationJob,
  createIndexTtsGeneration,
  getProjectSound,
  indexTtsHealth,
  registerIndexTtsVoiceReferenceFromFile,
  resolveIndexTtsVoiceReference,
  unloadIndexTtsModel,
  validateIndexTtsVoiceReferenceFromFile
} from "./index-tts.js";
import {
  bindQwenTtsGenerationJob,
  createQwenTtsGeneration,
  getProjectQwenSound,
  loadQwenTtsModel,
  qwenTtsHealth,
  resolveQwenTtsVoiceReference,
  unloadQwenTtsModel
} from "./qwen-tts.js";
import {
  H02_EXTERNAL_PROJECT_SLUG,
  isExternalQueueJobId,
  readExternalH02DialogueCues
} from "./external-h02-queue.js";
import {
  attachVoiceDesignAssetId,
  attachVoiceDesignIndexTtsVoiceId,
  bindVoiceDesignSessionJob,
  buildVoiceDesignAssetHook,
  buildVoiceDesignIndexTtsHook,
  createVoiceDesignSession,
  getProjectVoiceDesign,
  loadQwenVoiceDesign,
  qwenVoiceDesignHealth,
  qwenVoiceDesignInstallStatus,
  queueVoiceDesignRegeneration,
  renameVoiceDesignAudition,
  safeVoiceDesignProjectFile,
  saveVoiceDesignVoice,
  selectVoiceDesignAudition,
  softDeleteVoiceDesignAudition,
  unloadQwenVoiceDesign,
  voiceDesignContainingFolder
} from "./qwen-voice-design.js";
import {
  AUDIO_WORKFLOW_IMPORT_ROOT,
  getAudioWorkflowCatalog,
  getAudioWorkflowProfile,
  importAudioWorkflow,
  publicAudioWorkflowProfile,
  rebindAudioWorkflowProfile,
  renameAudioWorkflowProfile,
  scanAudioWorkflowCandidates,
  setAudioWorkflowEnabled
} from "./audio-workflows.js";
import {
  buildAudioEditPlacement,
  deleteProjectAudioAssetToTrash,
  getProjectAudioState,
  patchProjectAudioAsset,
  performProjectAudioAssetAction
} from "./audio-assets.js";
import { prepareAudioGenerationRecords } from "./audio-generation.js";
import {
  fillI2vPrompt,
  normalizeSegments,
  clampDuration,
  framesOf,
  groupContiguousSegments
} from "./timeline.js";
import {
  H3_DISPLAY_NAME,
  H3_MODE_FIRST,
  H3_MODE_REFERENCE,
  H3_MODES,
  compileH3Prompt,
  h3Diagnostics,
  splitH3Ranges
} from "./h3.js";
import { ffmpegAvailable, probeMedia } from "./ffmpeg.js";
import { normalizeBookends } from "./bookends.js";
import { PACKAGE_ROOT, PROJECTS_DIR, CLIENT_DIST, projectDir } from "./paths.js";
import { resolveProjectMediaFile } from "./media-path.js";
import {
  SCREENPLAY_MODEL,
  screenplayModelHealth,
  generateScreenplayPackage,
  streamScreenplayConversation,
  createShotPlan,
  normalizeShotPlan
} from "./screenplay.js";
import {
  ASSET_WORKFLOWS,
  ASSET_CATEGORY_LABELS,
  assetMediaType,
  defaultAssetWorkflow,
  assetApprovalCurrent,
  assetGenerationFingerprint,
  assetVersionFingerprint,
  assetVersionFilesCurrent,
  buildAssetPackage,
  createDirectorAsset,
  getAssetWorkflowCatalog,
  promoteAssetToFrame,
  saveAssetPackageFiles,
  updateAssetManifestCounts,
  reconcileAssetGenerationState,
  withAssetPromptHeader,
  registerDirectorAssetImage,
  registerDirectorAssetAudio,
  validateAssetWorkflow
} from "./assets.js";
import { premierePiAgent, PREMIERE_PI_MODEL } from "./pi-agent.js";
import {
  cancelPromptEnhance,
  getPromptEnhanceStatus,
  grokCliAvailable,
  startPromptEnhance
} from "./prompt-enhance.js";
import {
  PromptGenerationError,
  createAndEnqueuePromptGeneration,
  getPromptGenerationWorkflowCatalog,
  promptComposerAssetProvenanceChanges
} from "./prompt-generation.js";
import {
  AssetPromptAudioError,
  combineAssetPromptWorkflowCatalog,
  createAndEnqueueAssetPromptAudio,
  getAssetPromptAudioWorkflowCatalog,
  isAssetPromptAudioRequest
} from "./asset-prompt-audio.js";
import {
  loadStoryboard,
  saveStoryboard,
  validateStoryboard,
  ensureStoryboard,
  seedStoryboardFromShotPlan,
  saveStoryboardTargetReferences,
  storyboardSummary,
  applyGlobalPromptToScope,
  applyStoryboardDirection,
  applyStoryboardStructure
} from "./storyboard.js";
import {
  compileStoryboardFramePrompt,
  compileStoryboardVideoPlanPrompt,
  downloadStoryboardFrameWorkflow,
  downloadStoryboardVideoPlanWorkflow,
  markStoryboardFrameQueued,
  markStoryboardVideoPlanQueued,
  pushAllStoryboardFrameWorkflowsToComfyUI,
  pushStoryboardFrameToComfyUI,
  pushStoryboardVideoPlanToComfyUI,
  registerStoryboardFrameReplacement
} from "./storyboard-generation.js";
import { startComfyOutputIngest } from "./comfy-output-ingest.js";
import { readAaaWorkflow, writeAaaWorkflow, listWorkflows, readWorkflowGraph } from "./aaa-workflow.js";
import {
  editorWorkspace,
  importEditorAudio,
  importEditorVideo,
  loadEditDocument,
  probeEditorMedia,
  saveEditSequence
} from "./sequence-editor.js";
import {
  characterAssetKey,
  findCharacterVoiceAsset,
  findImportedVoiceSource,
  listAudacityVoiceSources,
  resolveAudacityVoiceSource
} from "./character-voices.js";
import {
  fixedUpstreamUrl,
  fixedUpstreamWebSocketUrl,
  isClientWorkspacePath,
  isEmbeddedLocalServiceReferer,
  isPermittedLocalGatewayRequest,
  proxyResponseHeaders,
  rewriteLocalServiceLocation,
  sameLocalServiceEndpoint,
  webSocketCloseArguments
} from "./local-service-proxy.js";

const PORT = process.env.PORT || 8789;
const HOST = process.env.HOST || "127.0.0.1";
const app = express();
app.use("/integrations/comfyui", (req, res) => handleComfyGatewayRequest(req, res, "/integrations/comfyui"));
app.use((req, res, next) => {
  if (!isEmbeddedComfyRequest(req)) return next();
  return handleComfyGatewayRequest(req, res, "/integrations/comfyui");
});
app.use(express.json({ limit: "100mb" }));

async function handleComfyGatewayRequest(req, res, publicPrefix) {
  try {
    if (!isLoopbackRequest(req)) return res.status(403).send("The embedded ComfyUI gateway is available only on this computer.");
    if (!isPermittedLocalGatewayRequest({ host: req.headers.host, origin: req.headers.origin, protocol: req.protocol })) {
      return res.status(403).send("The embedded ComfyUI gateway requires a local same-origin request.");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") return res.status(403).send("Cross-site ComfyUI mutations are blocked.");
      const protectedIds = await protectedComfyPromptIds();
      const pathname = new URL(req.url || "/", "http://premiere316.invalid").pathname;
      const exactCancel = pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
      const globalMutation = pathname === "/interrupt" || pathname === "/queue";
      const launchesPrompt = pathname === "/prompt";
      const activePremiereJob = listJobs().some((job) => ["running", "cancelling"].includes(String(job.status || "")));
      const localVoiceLease = gpuLeaseStatus();
      if (launchesPrompt && [GPU_RESOURCE_OWNERS.INDEX_TTS, GPU_RESOURCE_OWNERS.QWEN_TTS, GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN].includes(localVoiceLease?.owner)) {
        return res.status(409).json({ error: `Unload ${localVoiceLease.label || localVoiceLease.owner} before queueing a ComfyUI prompt on the shared GPU.` });
      }
      if ((globalMutation && (activePremiereJob || protectedIds.size)) || (exactCancel && protectedIds.has(decodeURIComponent(exactCancel[1])))) {
        return res.status(409).json({ error: "This ComfyUI mutation could stop a Premiere316 or LTX Director-owned prompt. Cancel it from the workspace that queued it." });
      }
    }
    if (["CONNECT", "TRACE"].includes(req.method)) return res.status(405).send("Unsupported gateway method.");
    proxyRawHttp(req, res, COMFY_URL, publicPrefix);
  } catch (error) {
    res.status(502).json({ error: `Could not validate the shared ComfyUI queue: ${String(error.message || error)}` });
  }
}

function isEmbeddedComfyRequest(req) {
  return isEmbeddedLocalServiceReferer({ host: req.headers.host, referer: req.headers.referer, protocol: req.protocol });
}

const execFileAsync = promisify(execFile);
const LMS_EXECUTABLE = process.env.LMS_EXECUTABLE || path.join(process.env.USERPROFILE || "", ".lmstudio", "bin", "lms.exe");
const GPU_HANDOFF_CONFIRMATION = "UNLOAD_QWEN_AND_CANCEL_ACTIVE_GENERATION";
const COMFY_CONTROL_SCRIPTS = Object.freeze({
  shared: path.join(PACKAGE_ROOT, "BlokeyUI", "restart_shared_engine.ps1"),
  dedicated: path.join(PACKAGE_ROOT, "BlokeyUI", "restart_premiere316_engine.ps1")
});
const PREMIERE_RESTART_SCRIPT = path.join(PACKAGE_ROOT, "restart_premiere316_app.ps1");
const PREMIERE_RESTART_HELPER = path.join(PACKAGE_ROOT, "scripts", "restart-premiere316.mjs");
const DIRECTOR_SERVER = path.join(PACKAGE_ROOT, "director-webapp", "server.mjs");
const DIRECTOR_URL = "http://127.0.0.1:8791";
let comfyRestarting = false;
let comfyRestartState = { status: "idle", startedAt: null, finishedAt: null, error: null, detail: null };
let directorProcess = null;
let directorStartPromise = null;
const integratedDirectorPromptIds = new Set();

function comfyControlScript(value = COMFY_URL) {
  const profile = managedComfyProfile(value);
  return profile ? COMFY_CONTROL_SCRIPTS[profile] : null;
}

function comfyQueuePromptIds(queue) {
  return new Set([...(queue?.queue_running || []), ...(queue?.queue_pending || [])]
    .map((entry) => Array.isArray(entry) ? entry[1] : entry?.prompt_id)
    .filter(Boolean)
    .map(String));
}

async function protectedComfyPromptIds() {
  if (!integratedDirectorPromptIds.size) return new Set();
  const queue = await getComfyQueueState();
  const activeIds = comfyQueuePromptIds(queue.raw);
  for (const id of [...integratedDirectorPromptIds]) if (!activeIds.has(String(id))) integratedDirectorPromptIds.delete(id);
  return new Set([...integratedDirectorPromptIds].filter((id) => activeIds.has(String(id))).map(String));
}

function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || "");
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function requireLocalSameOriginMutation(req, res, next) {
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (!isLoopbackRequest(req) || fetchSite === "cross-site" || !isPermittedLocalGatewayRequest({
    host: req.headers.host,
    origin: req.headers.origin,
    protocol: req.protocol
  })) {
    return res.status(403).json({ error: "Premiere316 editor changes require a local same-origin request." });
  }
  return next();
}

function proxyRawHttp(req, res, upstreamBase, publicPrefix) {
  const target = fixedUpstreamUrl(upstreamBase, req.url || "/");
  const transport = target.protocol === "https:" ? https : http;
  const headers = { ...req.headers, host: target.host, origin: target.origin, referer: `${target.origin}/` };
  for (const name of [
    "authorization",
    "connection",
    "cookie",
    "keep-alive",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
  ]) delete headers[name];

  const upstream = transport.request(target, { method: req.method, headers }, (response) => {
    res.status(response.statusCode || 502);
    for (const [name, value] of Object.entries(proxyResponseHeaders(response.headers))) {
      if (name.toLowerCase() === "location" && typeof value === "string") {
        const rewritten = rewriteLocalServiceLocation(value, upstreamBase, publicPrefix);
        if (!rewritten) {
          response.resume();
          return res.status(502).json({ error: "The local service tried to redirect outside its fixed gateway." });
        }
        res.setHeader(name, rewritten);
      } else {
        res.setHeader(name, value);
      }
    }
    response.pipe(res);
  });
  upstream.setTimeout(30_000, () => upstream.destroy(new Error("Local service gateway timed out")));
  req.once("aborted", () => upstream.destroy());
  res.once("close", () => { if (!res.writableEnded) upstream.destroy(); });
  upstream.on("error", (error) => {
    if (!res.headersSent) res.status(502).json({ error: `Local service gateway failed: ${String(error.message || error)}` });
    else res.destroy(error);
  });
  req.pipe(upstream);
}

async function directorRuntimeStatus() {
  try {
    const response = await fetch(`${DIRECTOR_URL}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { connected: false, compatible: false, health: null };
    const health = await response.json();
    return {
      connected: true,
      compatible: sameLocalServiceEndpoint(health?.comfyUrl, COMFY_URL),
      health
    };
  } catch {
    return { connected: false, compatible: false, health: null };
  }
}

async function directorAlive() {
  const status = await directorRuntimeStatus();
  return status.connected && status.compatible;
}

async function ensureDirectorService() {
  const existing = await directorRuntimeStatus();
  if (existing.connected && existing.compatible) return true;
  if (existing.connected) {
    throw new Error(`LTX Director is connected to ${existing.health?.comfyUrl || "an unknown engine"}, but Premiere316 is configured for ${COMFY_URL}. Stop or reconfigure Director before integrating it.`);
  }
  if (directorStartPromise) return directorStartPromise;
  directorStartPromise = (async () => {
    if (!fs.existsSync(DIRECTOR_SERVER)) throw new Error("The repository LTX Director service is unavailable.");
    directorProcess = spawn(process.execPath, [DIRECTOR_SERVER], {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        DIRECTOR_PORT: "8791",
        COMFY_URL,
        PREMIERE_API_URL: `http://127.0.0.1:${PORT}`
      },
      stdio: "ignore",
      windowsHide: true
    });
    directorProcess.once("error", () => { directorProcess = null; });
    directorProcess.once("exit", () => { directorProcess = null; });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await directorAlive()) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("LTX Director did not become ready on 127.0.0.1:8791.");
  })().finally(() => { directorStartPromise = null; });
  return directorStartPromise;
}

async function proxyDirectorApi(req, res) {
  try {
    if (!isLoopbackRequest(req)) return res.status(403).json({ error: "LTX Director is available only on this computer." });
    const suffix = String(req.params[0] || "").replace(/^\/+/, "");
    if (req.method === "POST" && (suffix === "queue" || suffix === "push-to-comfyui")) {
      try {
        const localVoiceLease = gpuLeaseStatus();
        if ([GPU_RESOURCE_OWNERS.INDEX_TTS, GPU_RESOURCE_OWNERS.QWEN_TTS, GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN].includes(localVoiceLease?.owner)) {
          return res.status(409).json({ error: `Unload ${localVoiceLease.label || localVoiceLease.owner} before queueing an LTX Director prompt on the shared GPU.` });
        }
        const { queueHellFromPremiere } = await import("./hell-comfy-push.js?t=" + Date.now());
        const result = await queueHellFromPremiere(req.body || {});
        for (const item of result.accepted || []) {
          if (item?.promptId) integratedDirectorPromptIds.add(String(item.promptId));
        }
        return res.status(202).json({
          ok: true,
          accepted: (result.accepted || []).map((item) => ({
            promptId: item.promptId,
            number: item.number,
            segmentId: item.segmentId || null
          }))
        });
      } catch (error) {
        return res.status(400).json({ error: String(error.message || error) });
      }
    }
    const directorStatus = await directorRuntimeStatus();
    if (!directorStatus.connected) return res.status(503).json({ error: "LTX Director is not running. Open Direct → LTX Director to start it." });
    if (!directorStatus.compatible) return res.status(409).json({ error: `LTX Director uses ${directorStatus.health?.comfyUrl || "an unknown engine"}; Premiere316 uses ${COMFY_URL}. Align the engine settings before sharing its queue.` });
    if (req.method === "POST" && suffix === "queue") {
      const activePremiereJobs = listJobs().filter((job) => ["queued", "running", "cancelling"].includes(String(job.status || "")));
      const comfyQueue = await getComfyQueueState();
      if (activePremiereJobs.length || comfyQueue.running || comfyQueue.pending) {
        return res.status(409).json({
          error: `Shared GPU is busy: ${activePremiereJobs.length} Premiere job(s), ${comfyQueue.running} ComfyUI running, ${comfyQueue.pending} ComfyUI queued.`
        });
      }
    }
    if (req.method === "POST" && suffix === "interrupt") {
      return res.status(409).json({ error: "Global interruption is disabled in the integrated workspace. Cancel the owning generation job instead." });
    }

    const target = fixedUpstreamUrl(DIRECTOR_URL, `/api/${suffix}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
    const method = req.method || "GET";
    const requestContentType = String(req.headers["content-type"] || "");
    const hasBody = method !== "GET" && method !== "HEAD";
    const jsonBody = hasBody && requestContentType.toLowerCase().includes("application/json");
    const body = !hasBody ? undefined : jsonBody ? JSON.stringify(req.body ?? {}) : req;
    const response = await fetch(target, {
      method,
      headers: {
        accept: req.headers.accept || "*/*",
        ...(hasBody && requestContentType ? { "content-type": requestContentType } : {}),
        ...(hasBody && !jsonBody && req.headers["content-length"] ? { "content-length": req.headers["content-length"] } : {})
      },
      body,
      ...(body === req ? { duplex: "half" } : {}),
      signal: AbortSignal.timeout(120_000)
    });
    res.status(response.status);
    for (const [name, value] of Object.entries(proxyResponseHeaders(Object.fromEntries(response.headers.entries())))) res.setHeader(name, value);
    if (!response.body) return res.end();
    if (method === "POST" && suffix === "queue" && String(response.headers.get("content-type") || "").includes("application/json")) {
      const payload = await response.json();
      for (const item of payload?.accepted || []) if (item?.promptId) integratedDirectorPromptIds.add(String(item.promptId));
      return res.json(payload);
    }
    const upstreamBody = Readable.fromWeb(response.body);
    upstreamBody.on("error", (streamError) => {
      if (!res.headersSent) res.status(502).json({ error: `LTX Director gateway stream failed: ${String(streamError.message || streamError)}` });
      else if (!res.destroyed) res.destroy(streamError);
    });
    res.once("close", () => {
      if (!res.writableEnded && !upstreamBody.destroyed) upstreamBody.destroy();
    });
    upstreamBody.pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: `LTX Director gateway failed: ${String(error.message || error)}` });
    else res.destroy(error);
  }
}

async function lmStudioGpuRuntime() {
  if (!fs.existsSync(LMS_EXECUTABLE)) return null;
  try {
    const { stdout } = await execFileAsync(LMS_EXECUTABLE, ["ps", "--json"], {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const instances = JSON.parse(String(stdout || "[]"));
    const instance = instances.find((item) => item.identifier === SCREENPLAY_MODEL) || null;
    return instance ? {
      identifier: instance.identifier,
      displayName: instance.displayName,
      status: instance.status,
      queued: Number(instance.queued) || 0,
      parallel: Number(instance.parallel) || 0,
      sizeGb: Math.round((Number(instance.sizeBytes) / (1024 ** 3)) * 10) / 10
    } : null;
  } catch {
    return null;
  }
}

function safeName(name, fallback) {
  return String(name || fallback || "media")
    .replace(/[^\w.\-()+ ]+/g, "_")
    .slice(0, 180);
}

function markClipDirty(clip, frame = null) {
  for (const segment of clip.segments || []) {
    if (frame == null || (segment.startFrame <= frame && segment.endFrame > frame)) segment.dirty = true;
  }
  clip.status = clip.versions?.length ? "dirty" : "ready";
}

function addGuide(project, clip, input) {
  const fps = project.settings.fps || 24;
  const totalFrames = framesOf(clip.durationSec, fps);
  const role = ["first", "middle", "last"].includes(input.role) ? input.role : "middle";
  const frame = role === "first"
    ? 0
    : role === "last"
      ? totalFrames - 1
      : Math.max(1, Math.min(totalFrames - 2, Math.round(Number(input.frame) || totalFrames / 2)));
  if (role !== "middle") clip.guides = (clip.guides || []).filter((g) => g.role !== role);
  const guide = {
    id: `guide_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    frame,
    file: input.file,
    prompt: String(input.prompt || ""),
    strength: Math.min(1, Math.max(0, Number(input.strength ?? 0.85))),
    seed: input.seed ?? null,
    source: input.source || "upload",
    versions: [{ v: 1, file: input.file, createdAt: new Date().toISOString() }],
    activeVersion: 1,
    createdAt: new Date().toISOString()
  };
  clip.guides = clip.guides || [];
  clip.guides.push(guide);
  syncGuideAliases(clip, fps);
  markClipDirty(clip, frame);
  return guide;
}

// ---------- health ----------
app.get("/api/health", async (_req, res) => {
  const [comfyStats, comfyQueue, ffmpeg, screenplay] = await Promise.all([
    getComfySystemStats().catch(() => null),
    getComfyQueueState().catch(() => null),
    ffmpegAvailable(),
    screenplayModelHealth()
  ]);
  const comfy = Boolean(comfyStats);
  const device = comfyStats?.devices?.[0] || null;
  const activePremiereJob = listJobs().find((job) => ["running", "cancelling"].includes(String(job.status || ""))) || null;
  const gpuLease = gpuLeaseStatus();
  const managedComfyScript = comfyControlScript();
  const managedComfyControl = process.platform === "win32" && Boolean(managedComfyScript) && fs.existsSync(managedComfyScript);
  const indexTts = indexTtsHealth();
  const qwenTts = qwenTtsHealth();
  const qwenVoiceDesign = {
    ...qwenVoiceDesignHealth(),
    gpu: device ? {
      name: String(device.name || "GPU").replace(/^cuda:\d+\s*/i, ""),
      totalVramBytes: Number(device.vram_total) || 0,
      freeVramBytes: Number(device.vram_free) || 0
    } : null
  };
  res.json({
    comfy,
    comfyRestarting,
    comfyRestartStatus: comfyRestartState.status,
    comfyUrl: COMFY_URL,
    ffmpeg,
    lmStudio: screenplay.online,
    screenplayModelAvailable: screenplay.modelAvailable,
    screenplayModel: SCREENPLAY_MODEL,
    lmStudioUrl: screenplay.url,
    comfyProxyReady: comfy,
    comfyEmbedUrl: "/integrations/comfyui/",
    comfyQueue: {
      running: comfyQueue?.running || 0,
      pending: comfyQueue?.pending || 0
    },
    gpu: device ? {
      name: String(device.name || "GPU").replace(/^cuda:\d+\s*/i, ""),
      totalBytes: Number(device.vram_total) || 0,
      freeBytes: Number(device.vram_free) || 0,
      usedBytes: Math.max(0, (Number(device.vram_total) || 0) - (Number(device.vram_free) || 0)),
      leaseOwner: gpuLease?.label || activePremiereJob?.type || (comfyQueue?.running ? "ComfyUI workflow" : null),
      leaseJobId: gpuLease?.jobId || activePremiereJob?.id || null,
      leaseState: gpuLease?.state || null,
      leaseWorkerPid: gpuLease?.workerPid || null
    } : null,
    providers: {
      lmStudio: { available: screenplay.online, modelAvailable: screenplay.modelAvailable, url: screenplay.url },
      comfyui: { available: comfy, url: COMFY_URL, proxy: "/integrations/comfyui/" },
      qwenTts,
      indexTts,
      qwenVoiceDesign,
      ffmpeg: { available: ffmpeg }
    },
    app: "premiere316",
    capabilities: {
      selectedRangeRender: true,
      guideUpload: false,
      ingredientsICLoRA: true,
      dedicatedComfyUI: isBundledComfyUrl(COMFY_URL),
      managedComfyControl,
      dedicatedComfyRestart: managedComfyControl && isBundledComfyUrl(COMFY_URL),
      premiereRestart: fs.existsSync(PREMIERE_RESTART_HELPER),
      screenplayGeneration: screenplay.online && screenplay.modelAvailable,
      screenplayStreamingChat: screenplay.online && screenplay.modelAvailable,
      piExpertOrchestrator: true,
      piExpertForcedSameModelWorker: true,
      piExpertModel: PREMIERE_PI_MODEL,
      assetApprovalGate: true,
      exactAssetVersionApproval: true,
      storyboardKreaImageGuides: true,
      storyboardLtx25T2VVideoPlans: true,
      explicitLmStudioGpuHandoff: true,
      recoverableProjectBinTrash: true,
      guideGenerator: "asset-foundry-only",
      scoreGenerator: ffmpeg ? "prototype-fallback" : "unavailable",
      masterAssembly: ffmpeg,
      deterministicMasterBookends: ffmpeg,
      qwenTtsVoiceClone: qwenTts.ready,
      indexTtsVoiceClone: indexTts.ready,
      qwenVoiceDesign: qwenVoiceDesign.ready
    }
  });
});

app.get("/api/sound/index-tts/health", (_req, res) => {
  res.json(indexTtsHealth());
});

app.get("/api/sound/qwen-tts/health", (_req, res) => {
  res.json(qwenTtsHealth());
});

app.post("/api/sound/qwen-tts/load", requireLocalSameOriginMutation, async (_req, res) => {
  try {
    const active = listJobs().find((job) =>
      ["queued", "running", "cancelling"].includes(String(job.status || "")) &&
      /(?:qwen_tts|qwen_voice_design|index_tts|render_|generate_asset|generate_prompt_asset|generate_audio_workflow|generate_storyboard)/.test(String(job.type || ""))
    );
    if (active) return res.status(409).json({ error: "Wait for or cancel the active GPU job before loading standalone Qwen3-TTS.", job: active });
    await prepareStandaloneQwenTtsRuntime();
    await loadQwenTtsModel();
    res.json({ ok: true, health: qwenTtsHealth() });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error), lease: error?.lease || gpuLeaseStatus() });
  }
});

app.post("/api/sound/qwen-tts/unload", requireLocalSameOriginMutation, async (_req, res) => {
  try {
    const active = listJobs().find((job) =>
      job.type === "generate_qwen_tts" && ["queued", "running", "cancelling"].includes(String(job.status || ""))
    );
    if (active) return res.status(409).json({ error: "Cancel the active Qwen3-TTS job before unloading its model.", job: active });
    const result = await unloadQwenTtsModel();
    res.json({ ok: true, ...result, health: qwenTtsHealth() });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
  }
});

async function qwenVoiceDesignStatusPayload() {
  const [stats, health] = await Promise.all([
    getComfySystemStats().catch(() => null),
    Promise.resolve(qwenVoiceDesignHealth())
  ]);
  const device = stats?.devices?.[0] || null;
  const installation = qwenVoiceDesignInstallStatus();
  const installing = ["running", "starting"].includes(String(installation.status || "").toLowerCase());
  return {
    ...health,
    state: installing ? "installing" : health.busy ? "generating" : health.loaded ? "loaded" : health.ready ? "unloaded" : "not-ready",
    attentionBackend: health.attentionImplementation,
    installation,
    lease: gpuLeaseStatus(),
    gpu: device ? {
      name: String(device.name || "GPU").replace(/^cuda:\d+\s*/i, ""),
      totalVramBytes: Number(device.vram_total) || 0,
      freeVramBytes: Number(device.vram_free) || 0
    } : null
  };
}

app.get("/api/sound/qwen-voice-design/status", async (_req, res) => {
  res.json({ status: await qwenVoiceDesignStatusPayload() });
});

app.post("/api/sound/qwen-voice-design/install", requireLocalSameOriginMutation, (req, res) => {
  try {
    const health = qwenVoiceDesignHealth();
    if (health.ready && req.body?.force !== true) return res.json({ ready: true, health });
    const job = enqueue({
      type: "install_qwen_voice_design",
      label: "Install pinned Qwen3-TTS VoiceDesign",
      refs: { force: req.body?.force === true }
    });
    res.status(202).json({ job, status: qwenVoiceDesignInstallStatus() });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
  }
});

app.post("/api/sound/qwen-voice-design/load", requireLocalSameOriginMutation, async (_req, res) => {
  try {
    const active = listJobs().find((job) =>
      ["queued", "running", "cancelling"].includes(String(job.status || "")) &&
      /(?:qwen_voice_design|qwen_tts|index_tts|render_|generate_asset|generate_prompt_asset|generate_audio_workflow|generate_storyboard)/.test(String(job.type || ""))
    );
    if (active) return res.status(409).json({ error: "Wait for or cancel the active GPU job before loading Qwen VoiceDesign.", job: active });
    await prepareLocalGpuRuntime(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN);
    await loadQwenVoiceDesign();
    res.json({ ok: true, status: await qwenVoiceDesignStatusPayload() });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error), lease: error?.lease || gpuLeaseStatus() });
  }
});

app.post("/api/sound/qwen-voice-design/unload", requireLocalSameOriginMutation, async (_req, res) => {
  try {
    const active = listJobs().find((job) =>
      job.type === "generate_qwen_voice_design" && ["queued", "running", "cancelling"].includes(String(job.status || ""))
    );
    if (active) return res.status(409).json({ error: "Cancel the active Qwen VoiceDesign job before unloading its model.", job: active });
    const result = await unloadQwenVoiceDesign();
    res.json({ ok: true, ...result, status: await qwenVoiceDesignStatusPayload() });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
  }
});

app.post("/api/sound/index-tts/unload", requireLocalSameOriginMutation, async (_req, res) => {
  try {
    const active = listJobs().find((job) =>
      job.type === "generate_index_tts" && ["queued", "running", "cancelling"].includes(String(job.status || ""))
    );
    if (active) return res.status(409).json({ error: "Cancel the active IndexTTS job before unloading its model.", job: active });
    const result = await unloadIndexTtsModel();
    res.json({ ok: true, ...result, health: indexTtsHealth() });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
  }
});

app.get("/api/integrations/ltx/status", async (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: "LTX Director is available only on this computer." });
  const status = await directorRuntimeStatus();
  res.json({ connected: status.connected, compatible: status.compatible, url: DIRECTOR_URL, health: status.health });
});

app.post("/api/integrations/ltx/start", async (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: "LTX Director can be started only on this computer." });
  try {
    await ensureDirectorService();
    res.json({ ok: true, connected: true, url: DIRECTOR_URL });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.all("/api/integrations/ltx/director/*", proxyDirectorApi);

app.get("/api/aaa-workflow/library", (req, res) => {
  try { res.json({ ok: true, ...listWorkflows(String(req.query.q || "")) }); }
  catch (error) { res.status(500).json({ error: String(error.message || error) }); }
});

app.get("/api/aaa-workflow/graph", (req, res) => {
  try { res.json({ ok: true, ...readWorkflowGraph({ rel: req.query.rel, id: req.query.id || req.query.workflowId }) }); }
  catch (error) {
    const status = /Ambiguous workflow/i.test(String(error.message || "")) ? 409 : 404;
    res.status(status).json({ error: String(error.message || error) });
  }
});

app.get("/api/aaa-workflow", (req, res) => {
  try { res.json({ ok: true, workflow: readAaaWorkflow(String(req.query.rel || "")) }); }
  catch (error) { res.status(500).json({ error: String(error.message || error) }); }
});

app.put("/api/aaa-workflow", (req, res) => {
  try { res.json({ ok: true, workflow: writeAaaWorkflow(req.body || {}) }); }
  catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});

app.get("/api/settings/comfyui", async (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: "ComfyUI connection settings are available only from this computer." });
  }
  return res.json({ comfyUrl: COMFY_URL, connected: await comfyAlive(), restartRequired: false });
});

app.put("/api/settings/comfyui", async (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: "The ComfyUI address can be changed only from this computer." });
  }
  const activePremiereJobs = listJobs().filter((job) => ["queued", "running", "cancelling"].includes(String(job.status || "")));
  if (activePremiereJobs.length) {
    return res.status(409).json({
      error: `Connection change blocked: Premiere316 has ${activePremiereJobs.length} queued or running generation job(s). Stop or finish them first.`
    });
  }

  let candidate;
  try {
    candidate = normalizeComfyUrl(req.body?.comfyUrl ?? req.body?.url);
  } catch (error) {
    return res.status(400).json({ error: String(error.message || error) });
  }

  try {
    const response = await fetch(`${candidate}/system_stats`, { signal: AbortSignal.timeout(7500) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const stats = await response.json();
    if (!stats?.system) throw new Error("the server did not return ComfyUI system information");
  } catch (error) {
    return res.status(503).json({
      error: `Could not connect to ComfyUI at ${candidate}: ${String(error.message || error)}`
    });
  }

  try {
    const comfyUrl = saveConfiguredComfyUrl(candidate);
    return res.json({ ok: true, comfyUrl, connected: true, restartRequired: comfyUrl !== COMFY_URL });
  } catch (error) {
    return res.status(500).json({ error: `Could not save the ComfyUI address: ${String(error.message || error)}` });
  }
});

app.post("/api/system/premiere/restart", (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: "Premiere316 can be restarted only from this computer." });
  }
  if (!fs.existsSync(PREMIERE_RESTART_HELPER)) {
    return res.status(501).json({ error: "The Premiere316 restart helper is unavailable on this installation." });
  }
  const child = spawn(process.execPath, [
    PREMIERE_RESTART_HELPER,
    String(process.pid)
  ], {
    cwd: PACKAGE_ROOT,
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.unref();
  res.status(202).json({ ok: true, restarting: true, port: Number(PORT) });
  setTimeout(() => process.exit(0), 1500);
});

app.post("/api/system/comfy/restart", async (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: "ComfyUI can be restarted only from this computer." });
  }
  let comfyUrl;
  try {
    comfyUrl = new URL(COMFY_URL);
  } catch {
    return res.status(409).json({ error: `The configured ComfyUI URL is invalid: ${COMFY_URL}` });
  }
  const controlScript = comfyControlScript(COMFY_URL);
  if (!controlScript) {
    return res.status(409).json({ error: "Start/restart is available only for this repository's local ComfyUI on port 8188 or 8190." });
  }
  if (process.platform !== "win32" || !fs.existsSync(controlScript)) {
    return res.status(501).json({ error: "The local ComfyUI start/restart helper is unavailable on this installation." });
  }
  if (comfyRestarting) {
    return res.status(409).json({ error: "ComfyUI is already starting or restarting." });
  }

  const activePremiereJobs = listJobs().filter((job) => ["queued", "running", "cancelling"].includes(String(job.status || "")));
  if (activePremiereJobs.length) {
    return res.status(409).json({
      error: `Restart blocked: Premiere316 has ${activePremiereJobs.length} queued or running generation job(s). Stop or finish them first.`
    });
  }

  const online = await comfyAlive();
  const action = online ? "restart" : "start";
  if (online) {
    try {
      const queueResponse = await fetch(new URL("/queue", comfyUrl), { signal: AbortSignal.timeout(5000) });
      if (!queueResponse.ok) throw new Error(`HTTP ${queueResponse.status}`);
      const queue = await queueResponse.json();
      const running = Array.isArray(queue?.queue_running) ? queue.queue_running.length : 0;
      const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending.length : 0;
      if (running || pending) {
        return res.status(409).json({
          error: `Restart blocked: ComfyUI has ${running} running and ${pending} pending prompt(s). Finish or cancel them first.`
        });
      }
    } catch (error) {
      return res.status(503).json({ error: `Could not verify the ComfyUI queue safely: ${String(error.message || error)}` });
    }
  }

  comfyRestarting = true;
  comfyRestartState = {
    status: action === "start" ? "starting" : "restarting",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    detail: null
  };
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  void execFileAsync(powershell, [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", controlScript
    ], {
      cwd: path.dirname(controlScript),
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 1024 * 1024
    })
    .then(async ({ stdout }) => {
      if (!await comfyAlive()) throw new Error(`The ${action} helper exited, but ComfyUI did not pass its health check.`);
      let detail = null;
      try { detail = JSON.parse(String(stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "null"); } catch {}
      comfyRestartState = {
        ...comfyRestartState,
        status: "ready",
        finishedAt: new Date().toISOString(),
        error: null,
        detail
      };
    })
    .catch((error) => {
      comfyRestartState = {
        ...comfyRestartState,
        status: "error",
        finishedAt: new Date().toISOString(),
        error: `ComfyUI ${action} failed: ${String(error.message || error)}`,
        detail: null
      };
    })
    .finally(() => { comfyRestarting = false; });

  return res.status(202).json({ ok: true, action, restarting: true, comfyUrl: COMFY_URL, state: comfyRestartState });
});

app.get("/api/system/comfy/restart/status", async (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: "ComfyUI restart status is available only from this computer." });
  }
  return res.json({ ...comfyRestartState, restarting: comfyRestarting, comfy: await comfyAlive(), comfyUrl: COMFY_URL });
});

app.get("/api/screenplay/health", async (_req, res) => {
  res.json(await screenplayModelHealth(5000));
});

app.post("/api/lm-studio/load-screenplay-model", async (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: "The screenplay model can be loaded only from this computer." });
  }
  if (!fs.existsSync(LMS_EXECUTABLE)) {
    return res.status(503).json({ error: `LM Studio CLI was not found at ${LMS_EXECUTABLE}` });
  }
  const current = await screenplayModelHealth(5000);
  if (current.online && current.modelAvailable) {
    return res.json({ ok: true, alreadyLoaded: true, model: SCREENPLAY_MODEL });
  }
  try {
    await execFileAsync(LMS_EXECUTABLE, [
      "load", SCREENPLAY_MODEL,
      "--identifier", SCREENPLAY_MODEL,
      "--gpu", "0.2",
      "--context-length", "32768",
      "--parallel", "1",
      "--ttl", "3600",
      "--yes"
    ], {
      timeout: 180000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const ready = await screenplayModelHealth(10000);
    if (!ready.online || !ready.modelAvailable) {
      throw new Error("LM Studio finished loading, but the pinned model is not available through its API.");
    }
    return res.json({ ok: true, alreadyLoaded: false, model: SCREENPLAY_MODEL });
  } catch (error) {
    return res.status(503).json({ error: `Could not load the pinned Qwen screenplay model: ${String(error.message || error)}` });
  }
});

// ---------- embedded Pi ComfyUI orchestrator ----------
app.use("/api/pi", (req, res, next) => {
  const remote = String(req.socket.remoteAddress || "").toLowerCase();
  if (remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1") return next();
  res.status(403).json({ error: "The embedded Pi agent is available only from this computer." });
});

app.put("/api/pi/context", (req, res) => {
  try {
    res.json({ context: premierePiAgent.updateContext(req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.get("/api/pi/status", async (_req, res) => {
  res.json(await premierePiAgent.status());
});

app.get("/api/pi/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const unsubscribe = premierePiAgent.subscribe(res);
  const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.post("/api/pi/prompt", async (req, res) => {
  try {
    const result = await premierePiAgent.prompt(req.body?.message, req.body?.context);
    res.json({ ...result, model: PREMIERE_PI_MODEL, orchestrator: true, sameModelWorker: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/pi/abort", async (_req, res) => {
  try {
    res.json(await premierePiAgent.abort());
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/pi/stop", async (_req, res) => {
  try {
    res.json(premierePiAgent.stop());
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

// ---------- projects ----------
app.get("/api/projects", (_req, res) => res.json({ projects: listProjects() }));

app.post("/api/projects", (req, res) => {
  try {
    const { name, category } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "name required" });
    res.json({ project: createProject(name.trim(), { category }) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.get("/api/projects/:slug", (req, res) => {
  try {
    const activeAssetIds = new Set(listJobs().filter((job) =>
      job.projectSlug === req.params.slug && job.type === "generate_asset" && ["queued", "running", "cancelling"].includes(job.status)
    ).map((job) => job.refs?.assetId).filter(Boolean));
    const project = reconcileAssetGenerationState(loadProject(req.params.slug), activeAssetIds);
    for (const asset of project.assets?.items || []) asset.approvalCurrent = assetApprovalCurrent(project, asset);
    res.json({ project });
  } catch (e) {
    res.status(404).json({ error: String(e.message) });
  }
});

app.get("/api/projects/:slug/storyboard", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const storyboard = ensureStoryboard(req.params.slug, {
      title: project.name,
      fps: project.settings?.fps,
      aspectRatio: project.settings?.aspectRatio || project.screenplay?.settings?.aspectRatio
    });
    res.json({ storyboard, summary: storyboardSummary(storyboard) });
  } catch (e) {
    res.status(404).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/storyboard/seed-from-plan", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const plan = req.body?.shotPlan || project.screenplay?.shotPlan || {};
    const result = seedStoryboardFromShotPlan(project.slug, plan, {
      title: project.name,
      fps: project.settings?.fps,
      aspectRatio: project.settings?.aspectRatio || project.screenplay?.settings?.aspectRatio,
      chapterId: req.body?.chapterId || "H01",
      sceneId: req.body?.sceneId || "H01-S01",
      chapterTitle: req.body?.chapterTitle || "Golgotha",
      sceneTitle: req.body?.sceneTitle || "EXT. GOLGOTHA"
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.put("/api/projects/:slug/storyboard", (req, res) => {
  try {
    loadProject(req.params.slug);
    const storyboard = validateStoryboard(req.body?.storyboard || req.body, req.params.slug);
    saveStoryboard(req.params.slug, storyboard);
    res.json({ storyboard, summary: storyboardSummary(storyboard) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.put("/api/projects/:slug/storyboard/targets/:targetKind/:targetId/references", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const result = saveStoryboardTargetReferences(req.params.slug, project, {
      targetKind: req.params.targetKind,
      targetId: req.params.targetId,
      references: req.body?.references
    });
    res.json({ ...result, summary: storyboardSummary(result.storyboard) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

const storyboardImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const STORYBOARD_IMAGE_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"]
]);

app.post("/api/projects/:slug/storyboard/frames/:frameId/replace-image", storyboardImageUpload.single("file"), (req, res) => {
  try {
    if (!req.file?.buffer?.length) return res.status(400).json({ error: "Image file required" });
    const extension = STORYBOARD_IMAGE_EXTENSIONS.get(String(req.file.mimetype || "").toLowerCase());
    if (!extension) return res.status(415).json({ error: "Use a PNG, JPEG, or WebP image." });
    const result = registerStoryboardFrameReplacement(req.params.slug, req.params.frameId, {
      buffer: req.file.buffer,
      extension,
      sourceFileName: req.file.originalname
    });
    res.json({ ...result, summary: storyboardSummary(result.storyboard) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.get("/api/projects/:slug/storyboard/frames/:frameId/workflow", async (req, res) => {
  try {
    const built = await downloadStoryboardFrameWorkflow(req.params.slug, req.params.frameId);
    res
      .type("application/json")
      .attachment(built.workflowName)
      .send(JSON.stringify(built.graph, null, 2));
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/storyboard/frames/:frameId/push-to-comfyui", async (req, res) => {
  try {
    res.json(await pushStoryboardFrameToComfyUI(req.params.slug, req.params.frameId));
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.get("/api/projects/:slug/storyboard/video-plans/:videoPlanId/workflow", async (req, res) => {
  try {
    const built = await downloadStoryboardVideoPlanWorkflow(req.params.slug, req.params.videoPlanId);
    res
      .type("application/json")
      .attachment(built.workflowName)
      .send(JSON.stringify(built.graph, null, 2));
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

async function pushStoryboardVideoPlanWorkflow(req, res) {
  try {
    res.json(await pushStoryboardVideoPlanToComfyUI(req.params.slug, req.params.videoPlanId));
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
}

app.post("/api/projects/:slug/storyboard/video-plans/:videoPlanId/workflow", pushStoryboardVideoPlanWorkflow);
app.post("/api/projects/:slug/storyboard/video-plans/:videoPlanId/push-to-comfyui", pushStoryboardVideoPlanWorkflow);

app.post("/api/projects/:slug/storyboard/video-plans/:videoPlanId/generate", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const storyboard = loadStoryboard(req.params.slug);
    const compiled = await compileStoryboardVideoPlanPrompt(project, storyboard, req.params.videoPlanId);
    const prepared = markStoryboardVideoPlanQueued(req.params.slug, req.params.videoPlanId);
    const job = enqueue({
      type: "generate_storyboard_video_plan",
      projectSlug: req.params.slug,
      label: `Generate storyboard T2V video · ${compiled.clip.id}`,
      refs: {
        videoPlanId: req.params.videoPlanId,
        clipId: compiled.clip.id,
        workflowId: compiled.graph.extra?.premiere316?.workflowId,
        workflowHash: compiled.workflowHash,
        generationFingerprint: prepared.generationFingerprint,
        filenamePrefix: prepared.filenamePrefix,
        seed: prepared.seed,
        settings: prepared.settings
      }
    });
    res.json({ storyboard: prepared.storyboard, summary: storyboardSummary(prepared.storyboard), job });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/storyboard/global-prompt", (req, res) => {
  try {
    const { clipId, scope, text } = req.body || {};
    if (!clipId) throw new Error("clipId is required");
    const result = applyGlobalPromptToScope(req.params.slug, clipId, text, scope);
    const storyboard = loadStoryboard(req.params.slug);
    res.json({ result, storyboard, summary: storyboardSummary(storyboard) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});


app.patch("/api/projects/:slug/storyboard/direction", (req, res) => {
  try {
    const result = applyStoryboardDirection(req.params.slug, req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/storyboard/structure", (req, res) => {
  try {
    const result = applyStoryboardStructure(req.params.slug, req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/storyboard/workflows/push-all-to-comfyui", async (req, res) => {
  try {
    res.json(await pushAllStoryboardFrameWorkflowsToComfyUI(req.params.slug));
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/storyboard/frames/:frameId/generate", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const storyboard = loadStoryboard(req.params.slug);
    const compiled = await compileStoryboardFramePrompt(project, storyboard, req.params.frameId);
    const prepared = markStoryboardFrameQueued(req.params.slug, req.params.frameId);
    const job = enqueue({
      type: "generate_storyboard_frame",
      projectSlug: req.params.slug,
      label: `Generate storyboard image · ${compiled.frame.ownerId || req.params.frameId}`,
      refs: {
        frameId: req.params.frameId,
        workflowId: compiled.graph.extra?.premiere316?.workflowId,
        workflowHash: compiled.workflowHash,
        generationFingerprint: prepared.generationFingerprint,
        filenamePrefix: prepared.filenamePrefix,
        seed: prepared.seed,
        resolution: prepared.resolution
      }
    });
    res.json({ storyboard: prepared.storyboard, summary: storyboardSummary(prepared.storyboard), job });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.put("/api/projects/:slug", (req, res) => {
  try {
    const existing = loadProject(req.params.slug);
    const body = req.body?.project || req.body;
    if (!body || body.slug !== existing.slug) return res.status(400).json({ error: "slug mismatch" });
    // Screenplay revision/approval and generated asset provenance are owned by
    // their dedicated endpoints. A browser tab with an older project snapshot
    // must never erase them when saving timeline or score edits.
    const merged = {
      ...body,
      slug: existing.slug,
      createdAt: existing.createdAt,
      category: existing.category || body.category || "feature",
      screenplay: existing.screenplay,
      assets: existing.assets,
      sound: existing.sound,
      frames: existing.frames,
      trash: existing.trash,
      // Clip creation, guide attachment, rendered versions, and frame aliases
      // are changed only through their dedicated, provenance-checking routes.
      // A full-project save is intentionally not a sequence mutation API.
      sequence: existing.sequence,
      score: {
        ...(body.score || existing.score || {}),
        versions: existing.score?.versions || [],
        activeVersion: existing.score?.activeVersion || 0
      },
      masters: existing.masters,
      activeMasterVersion: existing.activeMasterVersion
    };
    res.json({ project: saveProject(merged) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.delete("/api/projects/:slug", (req, res) => {
  try {
    deleteProject(req.params.slug);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

// ---------- screenplay ----------
app.put("/api/projects/:slug/screenplay", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const markdown = String(req.body?.markdown || "").trim();
    if (!markdown) return res.status(400).json({ error: "screenplay markdown required" });
    const changed = markdown !== String(project.screenplay?.markdown || "").trim();
    project.screenplay = {
      ...(project.screenplay || {}),
      markdown,
      model: req.body?.model || project.screenplay?.model || null,
      source: changed ? (req.body?.source || "import") : (project.screenplay?.source || req.body?.source || "import"),
      revision: crypto.createHash("sha256").update(markdown).digest("hex"),
      settings: { ...(project.screenplay?.settings || {}), ...(req.body?.settings || {}) },
      updatedAt: new Date().toISOString(),
      approval: changed ? null : project.screenplay?.approval || null
    };
    saveProject(project);
    res.json({ project, screenplay: project.screenplay });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

function currentScreenplayRevision(project) {
  const markdown = String(project?.screenplay?.markdown || "").trim();
  return markdown ? crypto.createHash("sha256").update(markdown).digest("hex") : null;
}

function screenplayApprovalCurrent(project) {
  if (skipApproval(project) || skipScreenplay(project)) return true;
  const screenplay = project?.screenplay;
  const revision = currentScreenplayRevision(project);
  return Boolean(
    screenplay?.approval?.status === "approved" &&
    screenplay.approval.screenplayRevision &&
    screenplay.approval.screenplayRevision === revision
  );
}

function assetManifestCurrent(project) {
  if (skipApproval(project) || skipScreenplay(project)) return true;
  return screenplayApprovalCurrent(project);
}

function canonicalFrameCurrent(project, frameOrFile) {
  const frame = typeof frameOrFile === "string"
    ? (project.frames || []).find((item) => item.file === frameOrFile)
    : frameOrFile;
  if (!frame) return false;
  if (skipApproval(project)) return Boolean(frame.file);
  if (frame.source !== "asset-foundry-approved" || !frame.assetId) return false;
  const asset = project.assets?.items?.find((item) => item.id === frame.assetId);
  return Boolean(
    asset &&
    assetApprovalCurrent(project, asset) &&
    Number(frame.assetVersion) === Number(asset.activeVersion) &&
    frame.assetApprovalFingerprint === asset.approval?.versionFingerprint &&
    frame.screenplayRevision === currentScreenplayRevision(project)
  );
}

function canonicalGuideBindings(project, clip) {
  const firstGuide = (clip.guides || []).find((guide) => guide.role === "first" || Number(guide.frame) === 0);
  if (!firstGuide?.file) return { ok: false, error: `${clip.name} has no first-frame guide` };
  const files = [...new Set([
    ...(clip.guides || []).map((guide) => guide.file),
    clip.firstFrame?.file,
    clip.endFrame?.file
  ].filter(Boolean))].sort();
  const bindings = [];
  for (const file of files) {
    const frame = (project.frames || []).find((item) => item.file === file);
    if (!frame) return { ok: false, error: `${clip.name} references missing Project Bin media: ${file}` };
    if (!canonicalFrameCurrent(project, frame)) return { ok: false, error: `${clip.name} uses a legacy, stale, or unapproved guide: ${frame.name || file}` };
    bindings.push({
      file,
      frameId: frame.id,
      assetId: frame.assetId,
      assetVersion: Number(frame.assetVersion),
      approvalFingerprint: frame.assetApprovalFingerprint,
      screenplayRevision: frame.screenplayRevision
    });
  }
  return { ok: true, bindings };
}

function clipRenderFingerprint(project, clip) {
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

function frameReferences(project, frameFile) {
  const references = [];
  for (const clip of project.sequence?.clips || []) {
    if (clip.firstFrame?.file === frameFile) references.push(`${clip.name}: first frame`);
    if (clip.endFrame?.file === frameFile) references.push(`${clip.name}: last frame`);
    for (const guide of clip.guides || []) if (guide.file === frameFile) references.push(`${clip.name}: ${guide.role || "middle"} guide`);
  }
  return references;
}

app.post("/api/projects/:slug/screenplay/approve", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!String(project.screenplay?.markdown || "").trim()) return res.status(400).json({ error: "There is no screenplay to approve" });
    const revision = currentScreenplayRevision(project);
    if (req.body?.expectedRevision && req.body.expectedRevision !== revision) {
      return res.status(409).json({ error: "The screenplay changed after it was reviewed. Reload it before approving this revision.", currentRevision: revision });
    }
    project.screenplay.approval = {
      status: "approved",
      approvedAt: new Date().toISOString(),
      screenplayUpdatedAt: project.screenplay.updatedAt,
      screenplayRevision: revision,
      approvedBy: String(req.body?.approvedBy || "Director").slice(0, 100)
    };
    project.screenplay.revision = project.screenplay.approval.screenplayRevision;
    const revisionsDir = path.join(projectDir(project.slug), "production", "screenplay-revisions");
    fs.mkdirSync(revisionsDir, { recursive: true });
    fs.writeFileSync(path.join(revisionsDir, `${revision}.md`), String(project.screenplay.markdown));
    saveProject(project);
    res.json({ project, approval: project.screenplay.approval });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/screenplay/chat/stream", async (req, res) => {
  let project;
  try {
    project = loadProject(req.params.slug);
    const health = await screenplayModelHealth(5000);
    if (!health.online) return res.status(503).json({ error: "LM Studio is offline at http://127.0.0.1:1234/v1" });
    if (!health.modelAvailable) return res.status(503).json({ error: `The required LM Studio model is not available: ${SCREENPLAY_MODEL}` });
  } catch (e) {
    return res.status(400).json({ error: String(e.message) });
  }

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const controller = new AbortController();
  let disconnected = false;
  let streamedText = "";
  const write = (event) => {
    if (!disconnected && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  res.on("close", () => {
    if (!res.writableEnded) {
      disconnected = true;
      controller.abort();
    }
  });

  const mode = String(req.body?.mode || (project.screenplay?.markdown ? "revise" : "generate"));
  const userText = String(req.body?.message || (mode === "generate" ? "Generate the complete screenplay package." : "Continue and improve the screenplay.")).trim();
  const streamRequestId = crypto.randomUUID();
  const streamStartedAt = Date.now();
  const heartbeat = setInterval(() => write({
    type: "heartbeat",
    requestId: streamRequestId,
    elapsedMs: Date.now() - streamStartedAt,
    visibleCharacters: streamedText.length
  }), 10000);
  heartbeat.unref?.();
  console.log(`[screenplay:${streamRequestId}] started`, {
    project: project.slug,
    mode,
    promptCharacters: userText.length,
    screenplayCharacters: String(req.body?.currentMarkdown || project.screenplay?.markdown || "").length
  });
  const userMessage = {
    id: `chat-${Date.now()}-user`,
    role: "user",
    content: userText,
    mode,
    createdAt: new Date().toISOString()
  };
  project.screenplay = {
    ...(project.screenplay || {}),
    markdown: String(req.body?.currentMarkdown || project.screenplay?.markdown || ""),
    model: SCREENPLAY_MODEL,
    settings: { ...(project.screenplay?.settings || {}), ...(req.body?.settings || {}) },
    chat: [...(Array.isArray(project.screenplay?.chat) ? project.screenplay.chat : []), userMessage].slice(-50)
  };
  saveProject(project);

  try {
    const result = await streamScreenplayConversation({
      mode,
      message: userText,
      currentMarkdown: req.body?.currentMarkdown || project.screenplay.markdown,
      history: req.body?.history || project.screenplay.chat,
      settings: req.body?.settings || project.screenplay.settings
    }, {
      signal: controller.signal,
      onEvent(event) {
        if (event.type === "delta") streamedText += String(event.content || "");
        write(event);
      }
    });

    const latest = loadProject(req.params.slug);
    const assistantMessage = {
      id: `chat-${Date.now()}-assistant`,
      role: "assistant",
      content: result.mode === "revise" ? result.response : "Completed a new screenplay package.",
      kind: result.mode === "revise" ? "reply" : "document",
      changed: result.changed,
      warning: result.patchWarning || null,
      createdAt: new Date().toISOString()
    };
    const previousRevision = currentScreenplayRevision(latest);
    const nextRevision = crypto.createHash("sha256").update(String(result.markdown || "").trim()).digest("hex");
    const screenplayChanged = previousRevision !== nextRevision;
    const retainedApproval = screenplayChanged ? null : latest.screenplay?.approval || null;
    latest.screenplay = {
      ...(latest.screenplay || {}),
      markdown: result.markdown,
      revision: nextRevision,
      model: result.model,
      source: result.mode === "revise" ? "lm-studio-chat-edit" : "lm-studio-stream",
      settings: { ...(latest.screenplay?.settings || {}), ...(result.settings || {}) },
      usage: result.usage,
      finishReason: result.finishReason,
      generatedAt: result.mode === "revise" ? latest.screenplay?.generatedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approval: retainedApproval,
      shotPlan: screenplayChanged ? null : latest.screenplay?.shotPlan || null,
      chat: [...(Array.isArray(latest.screenplay?.chat) ? latest.screenplay.chat : []), assistantMessage].slice(-50)
    };
    saveProject(latest);
    write({
      type: "done",
      markdown: result.markdown,
      response: result.response,
      changed: result.changed,
      warning: result.patchWarning || null,
      assistantMessage,
      updatedAt: latest.screenplay.updatedAt,
      approval: retainedApproval
    });
    console.log(`[screenplay:${streamRequestId}] completed`, {
      project: project.slug,
      mode: result.mode,
      elapsedMs: Date.now() - streamStartedAt,
      visibleCharacters: streamedText.length,
      finishReason: result.finishReason || null
    });
    res.end();
  } catch (e) {
    const aborted = controller.signal.aborted || e?.name === "AbortError";
    console.error(`[screenplay:${streamRequestId}] ${aborted ? "cancelled" : "failed"}`, {
      project: project.slug,
      mode,
      elapsedMs: Date.now() - streamStartedAt,
      visibleCharacters: streamedText.length,
      error: String(e?.message || e)
    });
    try {
      const latest = loadProject(req.params.slug);
      if (aborted && ["generate", "steer"].includes(mode) && streamedText.trim().length > 80) {
        latest.screenplay = {
          ...(latest.screenplay || {}),
          markdown: streamedText.trim(),
          revision: crypto.createHash("sha256").update(streamedText.trim()).digest("hex"),
          model: SCREENPLAY_MODEL,
          source: "lm-studio-partial",
          updatedAt: new Date().toISOString(),
          approval: null,
          shotPlan: null,
          chat: [...(Array.isArray(latest.screenplay?.chat) ? latest.screenplay.chat : []), {
            id: `chat-${Date.now()}-assistant`, role: "assistant", content: "Generation stopped; the partial draft was preserved.", kind: "stopped", createdAt: new Date().toISOString()
          }].slice(-50)
        };
        saveProject(latest);
      }
    } catch {}
    if (!aborted) write({ type: "error", error: String(e.message || e) });
    if (!res.writableEnded) res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

app.post("/api/projects/:slug/screenplay/generate", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const health = await screenplayModelHealth(5000);
    if (!health.online) return res.status(503).json({ error: "LM Studio is offline at http://127.0.0.1:1234/v1" });
    if (!health.modelAvailable) return res.status(503).json({ error: `The required LM Studio model is not available: ${SCREENPLAY_MODEL}` });
    const generated = await generateScreenplayPackage(req.body || {});
    project.screenplay = {
      ...(project.screenplay || {}),
      markdown: generated.markdown,
      revision: crypto.createHash("sha256").update(generated.markdown).digest("hex"),
      model: generated.model,
      source: "lm-studio",
      settings: generated.settings,
      usage: generated.usage,
      finishReason: generated.finishReason,
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approval: null,
      shotPlan: null
    };
    saveProject(project);
    res.json({ project, screenplay: project.screenplay });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/screenplay/shot-plan", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const markdown = String(req.body?.markdown || project.screenplay?.markdown || "").trim();
    const plan = await createShotPlan(markdown, req.body || {});
    project.screenplay = {
      ...(project.screenplay || {}),
      markdown,
      shotPlan: plan,
      model: project.screenplay?.model || SCREENPLAY_MODEL,
      updatedAt: new Date().toISOString()
    };
    saveProject(project);
    res.json({ project, shotPlan: plan });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/screenplay/build-timeline", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const fps = project.settings.fps || 24;
    let plan = req.body?.shotPlan ? normalizeShotPlan(req.body.shotPlan) : project.screenplay?.shotPlan;
    if (!plan?.shots?.length) {
      plan = await createShotPlan(project.screenplay?.markdown, req.body || {});
    }
    if (req.body?.replaceExisting) project.sequence.clips = [];

    const createdClips = [];
    for (const [shotIndex, shot] of plan.shots.entries()) {
      const sourceShotId = String(shot.id || `screenplay-shot-${shotIndex + 1}-${String(shot.name || "shot").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`);
      let clip = project.sequence.clips.find((candidate) => candidate.screenplayShot?.sourceShotId === sourceShotId);
      if (!clip) {
        clip = makeClip(project, {
          name: shot.name,
          durationSec: shot.durationSec,
          globalPrompt: shot.globalPrompt
        });
      } else {
        clip.name = shot.name;
        clip.durationSec = clampDuration(shot.durationSec);
        clip.globalPrompt = shot.globalPrompt;
      }
      const totalFrames = framesOf(clip.durationSec, fps);
      const prompts = shot.motionPrompts?.length ? shot.motionPrompts : [shot.globalPrompt];
      clip.segments = prompts.map((prompt, index) => ({
        id: `screenplay-${clip.id}-${index + 1}`,
        startFrame: Math.round((index * totalFrames) / prompts.length),
        endFrame: Math.round(((index + 1) * totalFrames) / prompts.length),
        prompt,
        dirty: true
      }));
      clip.segments = normalizeSegments(clip.segments, clip.durationSec, project.settings.segmentSec || 2, fps);
      clip.screenplayShot = {
        sourceShotId,
        index: shot.index,
        scene: shot.scene,
        firstFramePrompt: shot.firstFramePrompt,
        lastFramePrompt: shot.lastFramePrompt,
        dialogue: shot.dialogue,
        audioDirection: shot.audioDirection,
        voiceDirection: shot.voiceDirection
      };
      createdClips.push(clip);
    }
    recomputeStarts(project);
    project.screenplay = {
      ...(project.screenplay || {}),
      shotPlan: plan,
      timelineBuiltAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveProject(project);
    res.json({ project, shotPlan: plan, createdClipIds: createdClips.map((clip) => clip.id) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

// ---------- production assets ----------
app.get("/api/asset-workflows", async (_req, res) => {
  try {
    const [workflows, lmStudioGpu] = await Promise.all([getAssetWorkflowCatalog(), lmStudioGpuRuntime()]);
    res.json({ workflows, lmStudioGpu });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.get("/api/projects/:slug/character-voice-sources", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const catalog = listAudacityVoiceSources();
    const characters = (project.assets?.items || []).filter((asset) => asset.category === "character");
    const sources = catalog.sources.map((source) => {
      const imported = findImportedVoiceSource(project, source);
      const suggestions = characters.filter((asset) => characterAssetKey(asset) === source.characterKey);
      return {
        ...source,
        previewUrl: `/api/projects/${encodeURIComponent(project.slug)}/character-voice-sources/${encodeURIComponent(source.id)}/audio`,
        suggested: suggestions.length > 0,
        suggestedCharacterAssetId: suggestions[0]?.id || null,
        suggestedCharacterAssetIds: suggestions.map((asset) => asset.id),
        alreadyImported: Boolean(imported),
        existingAssetId: imported?.asset?.id || null,
        existingAssetName: imported?.asset?.name || null,
        existingVersion: imported?.version?.v ?? null
      };
    });
    res.json({
      root: catalog.root,
      exists: catalog.exists,
      sources,
      unsupportedProjects: catalog.unsupportedProjects,
      summary: {
        audioFiles: sources.length,
        alreadyImported: sources.filter((source) => source.alreadyImported).length,
        suggested: sources.filter((source) => source.suggested).length,
        unassigned: sources.filter((source) => !source.suggested).length
      }
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get("/api/projects/:slug/character-voice-sources/:sourceId/audio", (req, res) => {
  try {
    loadProject(req.params.slug);
    const source = resolveAudacityVoiceSource(req.params.sourceId);
    if (!source) return res.status(404).json({ error: "The Audacity source changed or is no longer available. Rescan the folder." });
    const contentTypes = new Map([
      [".wav", "audio/wav"],
      [".mp3", "audio/mpeg"],
      [".flac", "audio/flac"],
      [".m4a", "audio/mp4"],
      [".aac", "audio/aac"],
      [".ogg", "audio/ogg"]
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", contentTypes.get(source.extension) || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(source.fileName)}`);
    res.sendFile(source.absolute);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/projects/:slug/characters/:characterId/import-voice", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const character = project.assets?.items?.find((asset) => asset.id === req.params.characterId && asset.category === "character");
    if (!character) return res.status(404).json({ error: "Character asset not found" });
    const source = resolveAudacityVoiceSource(req.body?.sourceId);
    if (!source) return res.status(409).json({ error: "The Audacity source changed or is no longer available. Rescan the folder before importing." });

    const existing = findImportedVoiceSource(project, source);
    if (existing) {
      return res.json({
        alreadyImported: true,
        project,
        asset: existing.asset,
        version: existing.version,
        message: `${source.fileName} is already stored as ${existing.asset.name} v${existing.version.v}.`
      });
    }
    if (!assetManifestCurrent(project)) {
      return res.status(409).json({ error: "Approve the screenplay and refresh its asset manifest before importing a voice version." });
    }
    if (source.characterKey !== characterAssetKey(character)) {
      return res.status(409).json({ error: "This filename does not uniquely match the selected character. Use Add voice files in the Asset Library to make an explicit assignment." });
    }
    if (source.bytes > 128 * 1024 * 1024) return res.status(413).json({ error: "Voice source is larger than 128 MB." });

    let voiceAsset = findCharacterVoiceAsset(project, character, req.body?.voiceAssetId || null);
    if (voiceAsset && characterAssetKey(voiceAsset) !== characterAssetKey(character)) {
      return res.status(409).json({ error: "The selected voice asset belongs to a different character." });
    }
    if (!voiceAsset) {
      voiceAsset = createDirectorAsset({
        category: "voice",
        name: character.name,
        variant: "Voice Design",
        prompt: `Stable cinematic voice identity for ${character.name}. Preserve this imported performance as an immutable production reference.`,
        sampleText: "The hour has come.",
        workflowId: "qwen3-tts-voice-design-1.7b"
      }, project.assets?.items || []);
      project.assets.items.push(voiceAsset);
      updateAssetManifestCounts(project.assets);
    }

    const characterKey = characterAssetKey(character);
    voiceAsset.characterAssetId ||= character.id;
    voiceAsset.links = [
      ...(Array.isArray(voiceAsset.links) ? voiceAsset.links : []).filter((link) => link?.rel !== "character" || characterAssetKey(project.assets?.items?.find((asset) => asset.id === link.assetId)) !== characterKey),
      { rel: "character", assetId: character.id }
    ];
    for (const sibling of project.assets?.items || []) {
      if (sibling.category !== "character" || characterAssetKey(sibling) !== characterKey) continue;
      sibling.links = [
        ...(Array.isArray(sibling.links) ? sibling.links : []).filter((link) => link?.rel !== "voice-design"),
        { rel: "voice-design", assetId: voiceAsset.id }
      ];
    }

    const buffer = fs.readFileSync(source.absolute);
    const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
    if (actualHash !== source.sha256) return res.status(409).json({ error: "The Audacity source changed while it was being imported. Rescan and try again." });
    const result = registerDirectorAssetAudio(project, voiceAsset, {
      buffer,
      extension: source.extension,
      sourceFileName: source.fileName,
      contentType: ({ ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg" })[source.extension] || null
    });
    res.status(201).json({ ...result, alreadyImported: false, source: { id: source.id, fileName: source.fileName, sha256: source.sha256 } });
  } catch (e) {
    const message = String(e.message || e);
    const status = /not a project voice asset|different character/i.test(message) ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

app.get("/api/generation-workflows", async (req, res) => {
  try {
    const project = req.query?.project ? loadProject(String(req.query.project)) : null;
    const [visualWorkflows, audioWorkflows] = await Promise.all([
      getPromptGenerationWorkflowCatalog(),
      getAssetPromptAudioWorkflowCatalog(project)
    ]);
    res.json({ workflows: combineAssetPromptWorkflowCatalog(visualWorkflows, audioWorkflows) });
  } catch (e) {
    res.status(e instanceof PromptGenerationError || e instanceof AssetPromptAudioError ? e.status : 400).json({
      error: String(e.message || e),
      ...(e?.code ? { code: e.code } : {})
    });
  }
});

app.post("/api/projects/:slug/prompt-generations", requireLocalSameOriginMutation, async (req, res) => {
  try {
    const body = req.body || {};
    const prepared = isAssetPromptAudioRequest(body)
      ? await createAndEnqueueAssetPromptAudio(req.params.slug, body, {
        getCatalogFn: getAssetPromptAudioWorkflowCatalog,
        loadProjectFn: loadProject,
        saveProjectFn: saveProject,
        listJobsFn: listJobs,
        enqueueFn: enqueue,
        cancelJobFn: cancelJob
      })
      : await createAndEnqueuePromptGeneration(req.params.slug, body, {
        getCatalogFn: getPromptGenerationWorkflowCatalog,
        loadProjectFn: loadProject,
        saveProjectFn: saveProject,
        listJobsFn: listJobs,
        enqueueFn: enqueue
      });
    res.status(prepared.alreadyQueued ? 200 : 202).json(prepared);
  } catch (e) {
    const status = e instanceof PromptGenerationError || e instanceof AssetPromptAudioError ? e.status : Number(e?.statusCode) || 400;
    res.status(status).json({
      error: String(e.message || e),
      ...(e?.code ? { code: e.code } : {}),
      ...(Array.isArray(e?.errors) ? { errors: e.errors } : {})
    });
  }
});

app.post("/api/lm-studio/gpu-handoff", async (req, res) => {
  try {
    if (!isLoopbackRequest(req)) {
      return res.status(403).json({ error: "GPU handoff is available only from this computer." });
    }
    if (req.body?.confirmation !== GPU_HANDOFF_CONFIRMATION) {
      return res.status(409).json({
        error: "Explicit confirmation is required because unloading Qwen cancels any LM Studio response currently generating."
      });
    }
    if (!fs.existsSync(LMS_EXECUTABLE)) {
      return res.status(503).json({ error: `LM Studio CLI was not found at ${LMS_EXECUTABLE}` });
    }
    if (req.body?.expectedModel !== SCREENPLAY_MODEL) {
      return res.status(409).json({ error: "The expected LM Studio model does not match Premiere316's pinned screenplay model. Recheck GPU before trying again." });
    }

    const [before, runtime] = await Promise.all([getAssetWorkflowCatalog(true), lmStudioGpuRuntime()]);
    const handoffRequired = before.some((workflow) => workflow.ready && workflow.availableNow === false && workflow.runtimeWarning);
    if (!handoffRequired) {
      return res.json({ ok: true, unloaded: false, message: "GPU generation is already available.", workflows: before });
    }
    if (!runtime || runtime.identifier !== SCREENPLAY_MODEL) {
      return res.status(409).json({ error: "The pinned Qwen instance changed or is no longer loaded. Recheck GPU before trying again.", workflows: before });
    }
    if (runtime.status === "generating" && req.body?.confirmCancelGenerating !== true) {
      return res.status(409).json({
        code: "LM_STUDIO_GENERATING",
        error: "Qwen is actively generating. Confirm cancellation before releasing its GPU memory.",
        runtime,
        workflows: before
      });
    }

    await execFileAsync(LMS_EXECUTABLE, ["unload", SCREENPLAY_MODEL], {
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });

    let workflows = await getAssetWorkflowCatalog(true);
    for (let attempt = 0; attempt < 12 && workflows.some((workflow) => workflow.ready && workflow.availableNow === false && workflow.runtimeWarning); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      workflows = await getAssetWorkflowCatalog(true);
    }

    const stillBlocked = workflows.some((workflow) => workflow.ready && workflow.availableNow === false && workflow.runtimeWarning);
    if (stillBlocked) {
      return res.status(409).json({
        error: "LM Studio accepted the unload request, but GPU memory has not been released yet. Wait a moment and recheck GPU.",
        workflows
      });
    }

    res.json({
      ok: true,
      unloaded: true,
      model: SCREENPLAY_MODEL,
      message: "Qwen was unloaded and ComfyUI asset generation is unlocked.",
      workflows,
      lmStudioGpu: null
    });
  } catch (e) {
    const message = String(e?.stderr || e?.message || e).trim();
    res.status(400).json({ error: `Could not release the LM Studio GPU model: ${message}` });
  }
});

app.post("/api/projects/:slug/assets/extract", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!screenplayApprovalCurrent(project)) return res.status(409).json({ error: "Approve the current screenplay revision before building or sending assets to generation." });
    const approvedRevision = currentScreenplayRevision(project);
    const markdown = String(req.body?.markdown || project.screenplay?.markdown || "").trim();
    if (!markdown) return res.status(400).json({ error: "Save or generate a screenplay before building assets" });
    if (markdown !== String(project.screenplay?.markdown || "").trim()) return res.status(409).json({ error: "Save and approve this edited screenplay revision before building assets." });
    const savedBreakdownPath = path.join(projectDir(project.slug), "production", "screenplay-production-breakdown.json");
    const savedReviewPath = path.join(projectDir(project.slug), "production", "screenplay-review.md");
    let productionBreakdown = req.body?.productionBreakdown || null;
    let reviewMarkdown = String(req.body?.reviewMarkdown || "");
    if (!productionBreakdown && fs.existsSync(savedBreakdownPath)) {
      try { productionBreakdown = JSON.parse(fs.readFileSync(savedBreakdownPath, "utf-8")); } catch {}
    }
    if (!reviewMarkdown && fs.existsSync(savedReviewPath)) reviewMarkdown = fs.readFileSync(savedReviewPath, "utf-8");
    if (productionBreakdown?.screenplayHash && productionBreakdown.screenplayHash !== approvedRevision) {
      return res.status(409).json({ error: "The saved screenplay review belongs to an older revision. Re-run the production review before rebuilding assets." });
    }
    if (productionBreakdown) productionBreakdown = { ...productionBreakdown, screenplayHash: approvedRevision };
    // The project file is authoritative, but the production manifest is also a
    // durable recovery point. Preserve generated versions if an older client or
    // interrupted migration temporarily cleared `project.assets`.
    let previousAssets = req.body?.replace ? null : project.assets;
    const savedManifestPath = path.join(projectDir(project.slug), "production", "asset-manifest.json");
    if (!previousAssets?.items?.length && fs.existsSync(savedManifestPath)) {
      try {
        const savedManifest = JSON.parse(fs.readFileSync(savedManifestPath, "utf-8"));
        if (savedManifest?.screenplayHash === approvedRevision && Array.isArray(savedManifest?.items) && savedManifest.items.length) previousAssets = savedManifest;
      } catch {}
    }
    const catalog = await getAssetWorkflowCatalog(true);
    project.assets = buildAssetPackage(markdown, {
      productionBreakdown,
      previous: previousAssets
    });
    project.assets.catalog = catalog;
    project.assets.reviewSource = productionBreakdown ? "structured-screenplay-review" : "screenplay-sections";
    for (const asset of project.assets.items) {
      const state = catalog.find((workflow) => workflow.id === asset.workflowId);
      asset.workflow = state ? {
        id: state.id,
        label: state.label,
        model: state.model,
        ready: state.ready,
        availableNow: state.availableNow,
        reason: state.runtimeWarning || state.reason,
        gpu: state.gpu,
        minimumFreeVramGb: state.minimumFreeVramGb
      } : { id: asset.workflowId, label: asset.workflowId, ready: false, reason: "Unknown workflow" };
    }
    saveAssetPackageFiles(project, {
      productionBreakdown,
      reviewMarkdown
    });
    saveProject(project);
    res.json({ project, assets: project.assets, workflows: catalog });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.patch("/api/projects/:slug/assets/:assetId", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const asset = project.assets?.items?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    const promptComposerAsset = asset.generationComposer === true || asset.regenerationMode === "prompt-composer" || asset.source === "prompt-generation-composer";
    const originalWorkflowId = asset.workflowId;
    const immutableChanges = promptComposerAssetProvenanceChanges(asset, req.body || {});
    if (immutableChanges.length) {
      return res.status(409).json({
        error: `Prompt-composer provenance is immutable (${immutableChanges.join(", ")}). Open the Prompt Composer to create a different generation.`,
        code: "PROMPT_COMPOSER_PROVENANCE_IMMUTABLE",
        fields: immutableChanges
      });
    }
    const beforeFingerprint = assetGenerationFingerprint(asset);
    const allowed = ["name", "variant", "prompt", "sampleText", "workflowId", "seed", "durationSec", "bpm", "status", "dependencies", "continuity", "activeVersion"];
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) asset[key] = req.body[key];
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "category")) {
      const category = String(req.body.category || "").trim();
      if (!Object.prototype.hasOwnProperty.call(ASSET_CATEGORY_LABELS, category)) return res.status(400).json({ error: `Unknown asset category: ${category}` });
      const changed = category !== asset.category;
      asset.category = category;
      asset.categoryLabel = ASSET_CATEGORY_LABELS[category];
      asset.mediaType = assetMediaType(category);
      if (changed && !Object.prototype.hasOwnProperty.call(req.body || {}, "workflowId")) {
        asset.workflowId = defaultAssetWorkflow(category, asset.variant, asset.name, asset.id);
      }
    }
    asset.name = String(asset.name || "").replace(/\s+/g, " ").trim().slice(0, 160);
    asset.variant = String(asset.variant || "Production Reference").replace(/\s+/g, " ").trim().slice(0, 120) || "Production Reference";
    if (!asset.name) return res.status(400).json({ error: "Asset name is required" });
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "activeVersion")) {
      const requested = Number(req.body.activeVersion);
      const exists = (asset.versions || []).some((version) => Number(version.v) === requested);
      if (!exists) return res.status(400).json({ error: `Version v${requested} is not on this asset.` });
      asset.activeVersion = requested;
      const restored = (asset.versions || []).find((version) => Number(version.v) === requested);
      if (restored?.file) asset.file = restored.file;
      asset.approval = null;
      asset.approvalCurrent = false;
    }
    asset.dependencies = Array.isArray(asset.dependencies) ? asset.dependencies.map((item) => String(item || "").trim()).filter(Boolean) : [];
    asset.continuity = Array.isArray(asset.continuity) ? asset.continuity.map((item) => String(item || "").trim()).filter(Boolean) : [];
    if (!promptComposerAsset) asset.prompt = withAssetPromptHeader(asset, asset.prompt);
    const unchangedPromptComposerWorkflow = promptComposerAsset && asset.workflowId === originalWorkflowId;
    if (asset.workflowId && !ASSET_WORKFLOWS.some((workflow) => workflow.id === asset.workflowId) && !unchangedPromptComposerWorkflow) {
      return res.status(400).json({ error: `Unknown asset workflow: ${asset.workflowId}` });
    }
    const catalog = await getAssetWorkflowCatalog();
    const state = catalog.find((workflow) => workflow.id === asset.workflowId);
    asset.workflow = state ? { id: state.id, label: state.label, model: state.model, ready: state.ready, availableNow: state.availableNow, reason: state.runtimeWarning || state.reason, gpu: state.gpu, minimumFreeVramGb: state.minimumFreeVramGb } : asset.workflow;
    if (assetGenerationFingerprint(asset) !== beforeFingerprint) asset.approval = null;
    asset.updatedAt = new Date().toISOString();
    updateAssetManifestCounts(project.assets);
    saveAssetPackageFiles(project);
    saveProject(project);
    res.json({ project, asset });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/assets", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!project.assets) {
      project.assets = {
        schemaVersion: 1,
        screenplayHash: currentScreenplayRevision(project),
        counts: {},
        total: 0,
        items: [],
        deletedItems: []
      };
    }
    project.assets.items ||= [];
    const asset = createDirectorAsset(req.body || {}, project.assets.items);
    project.assets.items.push(asset);
    const catalog = await getAssetWorkflowCatalog();
    const state = catalog.find((workflow) => workflow.id === asset.workflowId);
    asset.workflow = state ? { id: state.id, label: state.label, model: state.model, ready: state.ready, availableNow: state.availableNow, reason: state.runtimeWarning || state.reason, gpu: state.gpu, minimumFreeVramGb: state.minimumFreeVramGb } : { id: asset.workflowId, label: asset.workflowId, ready: false, reason: "Unknown workflow" };
    project.assets.catalog = catalog;
    updateAssetManifestCounts(project.assets);
    saveAssetPackageFiles(project);
    saveProject(project);
    res.status(201).json({ project, asset });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.delete("/api/projects/:slug/assets/:assetId", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const assets = project.assets?.items || [];
    const index = assets.findIndex((item) => item.id === req.params.assetId);
    if (index < 0) return res.status(404).json({ error: "Asset not found" });
    const asset = assets[index];
    if (String(req.body?.confirmation || "") !== asset.id) {
      return res.status(400).json({ error: "Asset ID confirmation does not match" });
    }
    const activeJob = listJobs().find((job) => job.projectSlug === project.slug && job.type === "generate_asset" && job.refs?.assetId === asset.id && ["queued", "running", "cancelling"].includes(job.status));
    if (activeJob) return res.status(409).json({ error: "Stop this asset's active generation job before deleting it." });
    if ((project.frames || []).some((frame) => frame.assetId === asset.id)) {
      return res.status(409).json({ error: "This asset is in the Project Bin. Remove its promoted frame before deleting the source asset." });
    }
    const deletedAt = new Date().toISOString();
    project.assets.deletedItems ||= [];
    project.assets.deletedItems.push({
      id: asset.id,
      deletedAt,
      recoverable: true,
      asset
    });
    project.assets.items.splice(index, 1);
    for (const item of project.assets.items) {
      if (Array.isArray(item.dependencies)) item.dependencies = item.dependencies.filter((id) => id !== asset.id);
    }
    updateAssetManifestCounts(project.assets);
    saveAssetPackageFiles(project);
    saveProject(project);
    res.json({ project, deleted: { id: asset.id, deletedAt, recoverable: true } });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});


app.post("/api/projects/:slug/assets/:assetId/versions/:version/restore", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const asset = project.assets?.items?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    const requested = Number(req.params.version);
    const versions = Array.isArray(asset.versions) ? asset.versions : [];
    const target = versions.find((version) => Number(version.v) === requested);
    if (!target) return res.status(400).json({ error: `Version v${requested} is not on this asset.` });
    const fromVersion = Number(asset.activeVersion || 0);
    const keptVersions = versions.map((version) => Number(version.v)).sort((left, right) => left - right);
    asset.activeVersion = requested;
    if (target.file) asset.file = target.file;
    asset.approval = null;
    asset.approvalCurrent = false;
    const timestamp = new Date().toISOString();
    const audit = {
      op: "restore",
      sourceEntity: `asset:${asset.id}`,
      relationship: "restore",
      previousRelationship: "none",
      assetId: asset.id,
      exactVersion: requested,
      previousVersion: fromVersion,
      approvalFingerprint: String(target.assetFingerprint || asset.approval?.versionFingerprint || ""),
      timestamp,
      opSource: "prior-v-api",
      keptVersions,
      deletedVersions: [],
      approved: false
    };
    const line = `VER restore ${timestamp}: active v${fromVersion} → v${requested}; later versions kept (${keptVersions.join(",")}); no delete; approval reset`;
    asset.continuity = Array.isArray(req.body?.continuity) ? req.body.continuity : [...(Array.isArray(asset.continuity) ? asset.continuity : []), line];
    asset.updatedAt = timestamp;
    saveAssetPackageFiles(project);
    saveProject(project);
    res.json({ project, asset, audit, versionsKept: keptVersions });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/assets/:assetId/approve", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!assetManifestCurrent(project)) return res.status(409).json({ error: "Approve the screenplay and refresh its asset manifest before approving an asset." });
    const asset = project.assets?.items?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    const active = (asset.versions || []).find((version) => Number(version.v) === Number(asset.activeVersion));
    if (!active || !active.createdAt || !active.workflowId || !active.assetFingerprint || !active.workflowHash || !active.screenplayRevision || !active.manifestScreenplayHash || !active.fileHashes?.length) {
      return res.status(409).json({ error: "This version predates exact provenance. Generate a fresh immutable version before approving it." });
    }
    if (req.body?.expectedVersion != null && Number(req.body.expectedVersion) !== Number(asset.activeVersion)) {
      return res.status(409).json({ error: "A newer asset version became active. Review that version before approving." });
    }
    const generationFingerprint = assetGenerationFingerprint(asset);
    const revision = currentScreenplayRevision(project);
    if (
      active.assetFingerprint !== generationFingerprint ||
      active.workflowId !== asset.workflowId ||
      String(active.workflowHash || "") !== String(asset.workflowHash || "") ||
      active.screenplayRevision !== revision ||
      active.manifestScreenplayHash !== project.assets.screenplayHash ||
      !assetVersionFilesCurrent(project, asset)
    ) {
      return res.status(409).json({ error: "The active version was generated from older direction. Generate a fresh version before approval." });
    }
    asset.approval = {
      status: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: String(req.body?.approvedBy || "Director").slice(0, 100),
      activeVersion: Number(asset.activeVersion),
      versionFingerprint: assetVersionFingerprint(asset),
      generationFingerprint,
      screenplayRevision: currentScreenplayRevision(project),
      workflowId: asset.workflowId,
      workflowHash: asset.workflowHash || null
    };
    saveAssetPackageFiles(project);
    saveProject(project);
    res.json({ project, asset, approval: asset.approval });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/assets/:assetId/generate", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const asset = project.assets?.items?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    if (asset.generationComposer === true || asset.regenerationMode === "prompt-composer" || asset.source === "prompt-generation-composer") {
      return res.status(409).json({ error: "This output uses exact prompt-composer references and cannot use legacy Asset Generation. Open the Prompt Composer to generate another version." });
    }
    if (!screenplayApprovalCurrent(project)) return res.status(409).json({ error: "Asset generation is locked until the current screenplay revision is approved." });
    if (!assetManifestCurrent(project)) return res.status(409).json({ error: "The production asset manifest is stale. Refresh Assets from the approved screenplay before generating." });
    const existingJob = listJobs().find((job) =>
      job.projectSlug === project.slug &&
      job.type === "generate_asset" &&
      job.refs?.assetId === asset.id &&
      ["queued", "running", "cancelling"].includes(job.status)
    );
    if (existingJob) return res.json({ project, job: existingJob, alreadyQueued: true });
    const catalog = await getAssetWorkflowCatalog();
    const state = catalog.find((workflow) => workflow.id === asset.workflowId);
    if (!state?.ready) {
      return res.status(409).json({
        error: state?.reason || "The selected workflow is not ready",
        code: state?.code || "WORKFLOW_NOT_READY",
        remediation: state?.remediation || (state?.code === "COMFY_OFFLINE" ? "start-comfy" : null),
        workflowId: asset.workflowId
      });
    }
    if (state.availableNow === false) return res.status(409).json({ error: state.runtimeWarning || "The selected workflow is waiting for GPU memory" });
    const validation = await validateAssetWorkflow(project, asset);
    if (!validation.ready) return res.status(409).json({ error: `Workflow validation failed: ${validation.errors.slice(0, 8).join("; ")}` });
    asset.status = "queued";
    asset.approval = null;
    asset.approvalCurrent = false;
    saveAssetPackageFiles(project);
    saveProject(project);
    const job = enqueue({
      type: "generate_asset",
      projectSlug: project.slug,
      label: `Generate asset · ${asset.name}`,
      refs: {
        assetId: asset.id,
        screenplayRevision: currentScreenplayRevision(project),
        manifestScreenplayHash: project.assets.screenplayHash,
        assetFingerprint: assetGenerationFingerprint(asset)
      }
    });
    res.json({ project, job });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/assets/generate-all", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!screenplayApprovalCurrent(project)) return res.status(409).json({ error: "Asset generation is locked until the current screenplay revision is approved." });
    if (!assetManifestCurrent(project)) return res.status(409).json({ error: "The production asset manifest is stale. Refresh Assets from the approved screenplay before generating." });
    if (!project.assets?.items?.length) return res.status(400).json({ error: "Build the asset manifest first" });
    const requested = new Set(Array.isArray(req.body?.assetIds) ? req.body.assetIds : []);
    if (!requested.size) return res.status(400).json({ error: "Select at least one asset. This endpoint never queues the entire manifest implicitly." });
    const promptComposerTargets = project.assets.items.filter((asset) =>
      requested.has(asset.id) &&
      (asset.generationComposer === true || asset.regenerationMode === "prompt-composer" || asset.source === "prompt-generation-composer")
    );
    if (promptComposerTargets.length) {
      return res.status(409).json({
        error: `Prompt Composer outputs cannot use legacy Asset Generation: ${promptComposerTargets.map((asset) => asset.name || asset.id).join(", ")}. Open the Prompt Composer to generate new versions.`
      });
    }
    const activeAssetIds = new Set(listJobs()
      .filter((job) =>
        job.projectSlug === project.slug &&
        job.type === "generate_asset" &&
        ["queued", "running", "cancelling"].includes(job.status)
      )
      .map((job) => job.refs?.assetId)
      .filter(Boolean));
    const catalog = await getAssetWorkflowCatalog();
    const ready = new Set(catalog.filter((workflow) => workflow.ready && workflow.availableNow !== false).map((workflow) => workflow.id));
    const targets = project.assets.items.filter((asset) =>
      requested.has(asset.id) &&
      !activeAssetIds.has(asset.id) &&
      ready.has(asset.workflowId) &&
      (req.body?.regenerate || !["generated", "ready-for-shot"].includes(asset.status))
    );
    for (const asset of targets) {
      const validation = await validateAssetWorkflow(project, asset);
      if (!validation.ready) return res.status(409).json({ error: `${asset.name}: ${validation.errors.slice(0, 8).join("; ")}` });
    }
    for (const asset of targets) {
      asset.status = "queued";
      asset.approval = null;
      asset.approvalCurrent = false;
    }
    saveAssetPackageFiles(project);
    saveProject(project);
    const jobs = targets.map((asset) => enqueue({
        type: "generate_asset",
        projectSlug: project.slug,
        label: `Generate asset · ${asset.name}`,
        refs: {
          assetId: asset.id,
          screenplayRevision: currentScreenplayRevision(project),
          manifestScreenplayHash: project.assets.screenplayHash,
          assetFingerprint: assetGenerationFingerprint(asset)
        }
      }));
    if (!jobs.length) {
      const requestedAssets = project.assets.items.filter((asset) => requested.has(asset.id));
      const reasons = requestedAssets.map((asset) => {
        const workflow = catalog.find((entry) => entry.id === asset.workflowId);
        return {
          assetId: asset.id,
          name: asset.name,
          workflowId: asset.workflowId,
          reason: workflow?.runtimeWarning || workflow?.reason || "Workflow is not ready",
          code: workflow?.code || "WORKFLOW_NOT_READY",
          remediation: workflow?.remediation || null
        };
      });
      const unknown = [...requested].filter((id) => !project.assets.items.some((asset) => asset.id === id));
      for (const id of unknown) reasons.push({ assetId: id, name: id, reason: "Asset not found", code: "NOT_FOUND" });
      return res.status(409).json({
        error: reasons[0]?.reason || "No assets were queued because no selected workflow is ready.",
        queued: 0,
        skipped: requested.size,
        reasons,
        remediation: reasons.find((item) => item.remediation)?.remediation || null
      });
    }
    res.json({ project, jobs, queued: jobs.length, skipped: Math.max(0, requested.size - jobs.length) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/assets/stop-generation", (req, res) => {
  try {
    loadProject(req.params.slug);
    const result = cancelAssetJobs(req.params.slug, req.body?.assetId || null);
    const project = loadProject(req.params.slug);
    res.json({ ok: true, ...result, project, jobs: listJobs() });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.get("/api/projects/:slug/assets/enhance-prompts", (req, res) => {
  try {
    loadProject(req.params.slug);
    res.json({
      ok: true,
      grokAvailable: grokCliAvailable(),
      enhance: getPromptEnhanceStatus(req.params.slug)
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/assets/enhance-prompts", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!screenplayApprovalCurrent(project)) {
      return res.status(409).json({ error: "Approve the current screenplay revision before enhancing asset prompts." });
    }
    if (!assetManifestCurrent(project)) {
      return res.status(409).json({ error: "The production asset manifest is stale. Refresh Assets from the approved screenplay first." });
    }
    if (!project.assets?.items?.length) {
      return res.status(400).json({ error: "Build the asset manifest before enhancing prompts." });
    }
    if (!grokCliAvailable()) {
      return res.status(503).json({ error: "Grok Build CLI was not found. Install Grok Build and ensure `~/.grok/bin/grok` is available, or set GROK_EXECUTABLE." });
    }
    const current = getPromptEnhanceStatus(project.slug);
    if (current.active) {
      return res.status(409).json({ error: "A Grok prompt enhance run is already active for this project.", enhance: current });
    }

    const assetIds = Array.isArray(req.body?.assetIds) ? req.body.assetIds.filter(Boolean) : null;
    const concurrency = Number(req.body?.concurrency) || undefined;

    // Fire-and-forget parallel Grok agents; client polls status + reloads project.
    startPromptEnhance(project, { assetIds, concurrency }).catch((error) => {
      console.error("[prompt-enhance]", project.slug, error);
    });

    res.status(202).json({
      ok: true,
      message: assetIds?.length
        ? `Enhancing ${assetIds.length} selected asset prompt(s) with parallel Grok agents…`
        : `Enhancing all ${project.assets.items.length} asset prompts with parallel Grok agents…`,
      enhance: getPromptEnhanceStatus(project.slug),
      grokAvailable: true
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/assets/enhance-prompts/stop", (req, res) => {
  try {
    loadProject(req.params.slug);
    const stopped = cancelPromptEnhance(req.params.slug);
    res.json({
      ok: true,
      stopped,
      enhance: getPromptEnhanceStatus(req.params.slug)
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/assets/:assetId/promote", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!assetManifestCurrent(project)) return res.status(409).json({ error: "The approved screenplay asset manifest is no longer current." });
    const asset = project.assets?.items?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    if (!assetApprovalCurrent(project, asset)) return res.status(409).json({ error: "Approve this exact generated asset version before adding it to the Project Bin." });
    if (req.body?.expectedVersion != null && Number(req.body.expectedVersion) !== Number(asset.activeVersion)) {
      return res.status(409).json({ error: "A newer asset version became active. Review it before adding it to the Project Bin." });
    }
    if (req.body?.expectedFingerprint && req.body.expectedFingerprint !== asset.approval?.versionFingerprint) {
      return res.status(409).json({ error: "The approved asset fingerprint changed. Reload and review the active version." });
    }
    const frame = promoteAssetToFrame(project, asset);
    saveProject(project);
    res.json({ project, frame });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

// ---------- media import ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
const editorUploadRoot = path.join(PACKAGE_ROOT, "staging", "editor-uploads");
const editorDiskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(editorUploadRoot, { recursive: true });
    cb(null, editorUploadRoot);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(String(file.originalname || "")).slice(0, 12);
    cb(null, `${Date.now()}_${crypto.randomUUID()}${ext}`);
  }
});
const editorAudioUpload = multer({ storage: editorDiskStorage, limits: { fileSize: 128 * 1024 * 1024, files: 1 } });
const editorVideoUpload = multer({ storage: editorDiskStorage, limits: { fileSize: 512 * 1024 * 1024, files: 1 } });
const indexTtsAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024, files: 1, fields: 12 }
});
const audioWorkflowUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 256 * 1024 * 1024, files: 1, fields: 16 }
});
const workflowJsonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024, files: 1, fields: 32 }
});
const qwenTtsAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024, files: 1, fields: 20 }
});
const AUDIO_UPLOAD_MIME_EXTENSIONS = new Map([
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/flac", ".flac"],
  ["audio/x-flac", ".flac"],
  ["audio/mp4", ".m4a"],
  ["audio/x-m4a", ".m4a"],
  ["audio/aac", ".aac"],
  ["audio/ogg", ".ogg"],
  ["application/ogg", ".ogg"]
]);
const AUDIO_UPLOAD_EXTENSIONS = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"]);

function audioUploadExtension(file) {
  const fromMime = AUDIO_UPLOAD_MIME_EXTENSIONS.get(String(file?.mimetype || "").toLowerCase());
  if (fromMime) return fromMime;
  const fromName = path.extname(String(file?.originalname || "")).toLowerCase();
  return AUDIO_UPLOAD_EXTENSIONS.has(fromName) ? fromName : null;
}

const ACTIVE_VOICE_DESIGN_STATUSES = new Set(["queued", "loading", "generating", "cancelling"]);

function voiceDesignAuditionContext(projectSlug, auditionId) {
  const result = getProjectVoiceDesign(projectSlug, { persistMigration: false });
  for (const session of result.voiceDesign.sessions || []) {
    const audition = (session.auditions || []).find((entry) => entry.id === String(auditionId || ""));
    if (audition) return { ...result, session, audition };
  }
  throw Object.assign(new Error("Qwen VoiceDesign audition not found"), { statusCode: 404 });
}

function publicVoiceDesignState(projectSlug, state) {
  const output = structuredClone(state || {});
  const savedByAudition = new Map((output.savedVoices || []).map((voice) => [voice.sourceAuditionId, voice]));
  output.selectedByCharacter = { ...(output.defaultByCharacter || {}) };
  output.sessions = (output.sessions || []).map((session) => ({
    ...session,
    auditions: (session.auditions || []).filter((audition) => !audition.deletedAt).map((audition) => {
      const saved = savedByAudition.get(audition.id);
      return {
        ...audition,
        nativeMediaUrl: audition.status === "done" && audition.nativeFile
          ? `/api/projects/${encodeURIComponent(projectSlug)}/sound/voice-design/auditions/${encodeURIComponent(audition.id)}/native`
          : null,
        productionMediaUrl: audition.status === "done" ? audition.productionMediaUrl || null : null,
        savedToLibrary: Boolean(saved),
        savedVoiceId: saved?.id || null,
        assetId: saved?.assetId || null,
        indexTtsVoiceId: saved?.indexTtsVoiceId || null
      };
    })
  }));
  return output;
}

function voiceDesignCharacters(project) {
  const items = project.assets?.items || [];
  return items.filter((asset) => asset.category === "character").map((character) => {
    let voiceAsset = null;
    try { voiceAsset = findCharacterVoiceAsset(project, character); } catch {}
    return {
      ...character,
      characterId: character.id,
      voiceDescription: voiceAsset?.prompt || null,
      voicePrompt: voiceAsset?.prompt || null,
      sampleText: voiceAsset?.sampleText || null,
      voiceAssetId: voiceAsset?.id || null
    };
  });
}

function reconcileInterruptedVoiceDesign(project, activeSessionIds) {
  const state = project.sound?.voiceDesign;
  if (!state?.sessions?.length) return false;
  let changed = false;
  const now = new Date().toISOString();
  for (const session of state.sessions) {
    if (!ACTIVE_VOICE_DESIGN_STATUSES.has(String(session.status || "")) || activeSessionIds.has(session.id)) continue;
    session.status = "interrupted";
    session.error = "Generation was interrupted before Premiere316 registered all audition outputs.";
    session.updatedAt = now;
    session.finishedAt = now;
    for (const audition of session.auditions || []) {
      if (!["queued", "loading", "generating", "cancelling"].includes(String(audition.status || ""))) continue;
      audition.status = "interrupted";
      audition.error = session.error;
      audition.updatedAt = now;
      audition.finishedAt = now;
    }
    changed = true;
  }
  if (changed) saveProject(project);
  return changed;
}

function ensureVoiceAssetContainer(project) {
  if (!project.assets || typeof project.assets !== "object") {
    project.assets = {
      schemaVersion: 1,
      screenplayHash: currentScreenplayRevision(project),
      counts: {},
      total: 0,
      items: [],
      deletedItems: []
    };
  }
  project.assets.items = Array.isArray(project.assets.items) ? project.assets.items : [];
  project.assets.deletedItems = Array.isArray(project.assets.deletedItems) ? project.assets.deletedItems : [];
  return project.assets;
}

async function saveVoiceDesignAuditionToAssetLibrary(projectSlug, sessionId, auditionId) {
  const saved = saveVoiceDesignVoice(projectSlug, sessionId, auditionId);
  const hook = buildVoiceDesignAssetHook(projectSlug, sessionId, auditionId);
  const project = loadProject(projectSlug);
  const assets = ensureVoiceAssetContainer(project);
  const character = hook.characterId
    ? assets.items.find((asset) => asset.id === hook.characterId && asset.category === "character") || null
    : null;
  let asset = saved.voice.assetId ? assets.items.find((entry) => entry.id === saved.voice.assetId && entry.category === "voice") : null;
  if (!asset && character) asset = findCharacterVoiceAsset(project, character);
  if (!asset) {
    asset = createDirectorAsset({
      category: "voice",
      name: hook.voiceName,
      variant: "Voice Design",
      prompt: hook.prompt,
      sampleText: hook.sampleText,
      workflowId: "qwen3-tts-voice-design-1.7b"
    }, assets.items);
    assets.items.push(asset);
  }
  if (character) {
    asset.characterAssetId = character.id;
    asset.links = [
      ...(Array.isArray(asset.links) ? asset.links : []).filter((link) => link?.rel !== "character"),
      { rel: "character", assetId: character.id }
    ];
    character.links = [
      ...(Array.isArray(character.links) ? character.links : []).filter((link) => link?.rel !== "voice-design"),
      { rel: "voice-design", assetId: asset.id }
    ];
  }
  asset.sampleText = hook.sampleText;
  updateAssetManifestCounts(assets);

  const existingVersion = (asset.versions || []).find((version) =>
    version?.voiceDesign?.sourceAuditionId === auditionId &&
    version?.voiceDesign?.sha256 === hook.metadata?.sha256
  );
  if (existingVersion) {
    saveAssetPackageFiles(project);
    saveProject(project);
    const voice = attachVoiceDesignAssetId(projectSlug, saved.voice.id, asset.id);
    return { project: loadProject(projectSlug), asset, version: existingVersion, voice, alreadySaved: true };
  }

  const buffer = fs.readFileSync(hook.sourceFile);
  const result = registerDirectorAssetAudio(project, asset, {
    buffer,
    extension: ".wav",
    sourceFileName: hook.sourceFileName,
    contentType: hook.contentType,
    metadata: {
      ...hook.metadata,
      assetId: asset.id,
      model: hook.metadata?.modelId,
      transcript: hook.metadata?.auditionTranscript,
      provenanceType: "synthetic-designed-voice"
    }
  });
  const voice = attachVoiceDesignAssetId(projectSlug, saved.voice.id, asset.id);
  return { ...result, voice, alreadySaved: false };
}

function publicVoiceDesignSession(projectSlug, sessionId) {
  const result = getProjectVoiceDesign(projectSlug, { persistMigration: false });
  return publicVoiceDesignState(projectSlug, result.voiceDesign).sessions.find((session) => session.id === sessionId) || null;
}

app.get("/api/projects/:slug/sound", (req, res) => {
  try {
    const activeIndexGenerationIds = new Set(listJobs()
      .filter((job) =>
        job.projectSlug === req.params.slug &&
        job.type === "generate_index_tts" &&
        ["queued", "running", "cancelling"].includes(String(job.status || ""))
      )
      .map((job) => job.refs?.generationId)
      .filter(Boolean));
    const activeQwenGenerationIds = new Set(listJobs()
      .filter((job) =>
        job.projectSlug === req.params.slug &&
        job.type === "generate_qwen_tts" &&
        ["queued", "running", "cancelling"].includes(String(job.status || ""))
      )
      .map((job) => job.refs?.generationId)
      .filter(Boolean));
    const indexResult = getProjectSound(req.params.slug, activeIndexGenerationIds);
    const qwenResult = getProjectQwenSound(req.params.slug, activeQwenGenerationIds);
    const persistedDialogueCues = qwenResult.sound?.dialogueCues || [];
    const externalDialogueCues = req.params.slug === H02_EXTERNAL_PROJECT_SLUG
      ? readExternalH02DialogueCues()
      : [];
    // Once the validated masters have been imported, the project-owned rows
    // are the durable source for Create Sound. A finished/stale external batch
    // adapter may legitimately return no rows and must not hide those 34 cues.
    const dialogueCues = externalDialogueCues.length
      ? externalDialogueCues
      : persistedDialogueCues;
    res.json({
      ...qwenResult,
      sound: {
        ...qwenResult.sound,
        dialogueCues
      },
      dialogueCues,
      health: {
        ...qwenResult.health,
        primaryProvider: "qwenTts",
        providers: {
          qwenTts: qwenResult.health,
          indexTts: indexResult.health
        },
        qwenTts: qwenResult.health,
        indexTts: indexResult.health
      }
    });
  } catch (error) {
    res.status(404).json({ error: String(error.message || error) });
  }
});

app.get("/api/projects/:slug/sound/voice-design", async (req, res) => {
  try {
    const activeSessionIds = new Set(listJobs()
      .filter((job) =>
        job.projectSlug === req.params.slug &&
        job.type === "generate_qwen_voice_design" &&
        ["queued", "running", "cancelling"].includes(String(job.status || ""))
      )
      .map((job) => job.refs?.sessionId)
      .filter(Boolean));
    let result = getProjectVoiceDesign(req.params.slug);
    if (reconcileInterruptedVoiceDesign(result.project, activeSessionIds)) result = getProjectVoiceDesign(req.params.slug, { persistMigration: false });
    res.json({
      voiceDesign: publicVoiceDesignState(req.params.slug, result.voiceDesign),
      characters: voiceDesignCharacters(result.project),
      health: { providers: { qwenVoiceDesign: await qwenVoiceDesignStatusPayload() } }
    });
  } catch (error) {
    res.status(Number(error?.statusCode) || 404).json({ error: String(error.message || error) });
  }
});

app.post("/api/projects/:slug/sound/voice-design/auditions", requireLocalSameOriginMutation, (req, res) => {
  try {
    const health = qwenVoiceDesignHealth();
    if (!health.ready) return res.status(503).json({ error: health.reason, health });
    const project = loadProject(req.params.slug);
    const session = createVoiceDesignSession(project, req.body || {});
    const job = enqueue({
      type: "generate_qwen_voice_design",
      projectSlug: project.slug,
      label: `Voice Design · ${session.voiceName}`,
      refs: { sessionId: session.id, characterId: session.characterId }
    });
    bindVoiceDesignSessionJob(project.slug, session.id, job.id);
    res.status(202).json({ session: publicVoiceDesignSession(project.slug, session.id), job });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
  }
});

app.get("/api/projects/:slug/sound/voice-design/auditions/:auditionId/native", (req, res) => {
  try {
    const { project, audition } = voiceDesignAuditionContext(req.params.slug, req.params.auditionId);
    if (audition.deletedAt) return res.status(404).json({ error: "Qwen VoiceDesign audition not found" });
    if (audition.status !== "done" || !audition.nativeFile) return res.status(409).json({ error: "The native audition master is not ready" });
    const file = safeVoiceDesignProjectFile(project.slug, audition.nativeFile, "production/qwen3-tts/voice-design/");
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return res.status(404).json({ error: "The native audition WAV is missing" });
    res.type("audio/wav");
    res.setHeader("Cache-Control", "private, no-cache");
    res.sendFile(file);
  } catch (error) {
    res.status(Number(error?.statusCode) || 404).json({ error: String(error.message || error) });
  }
});

app.patch("/api/projects/:slug/sound/voice-design/auditions/:auditionId", requireLocalSameOriginMutation, (req, res) => {
  try {
    const context = voiceDesignAuditionContext(req.params.slug, req.params.auditionId);
    if (["queued", "loading", "generating", "cancelling"].includes(String(context.audition.status || ""))) {
      return res.status(409).json({ error: "Wait for or cancel this audition before renaming it." });
    }
    renameVoiceDesignAudition(context.project.slug, context.session.id, context.audition.id, req.body?.name);
    res.json({ session: publicVoiceDesignSession(context.project.slug, context.session.id) });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
  }
});

app.delete("/api/projects/:slug/sound/voice-design/auditions/:auditionId", requireLocalSameOriginMutation, (req, res) => {
  try {
    const context = voiceDesignAuditionContext(req.params.slug, req.params.auditionId);
    if (["queued", "loading", "generating", "cancelling"].includes(String(context.audition.status || ""))) {
      return res.status(409).json({ error: "Cancel the active audition before removing it." });
    }
    softDeleteVoiceDesignAudition(context.project.slug, context.session.id, context.audition.id);
    res.json({ removed: true, session: publicVoiceDesignSession(context.project.slug, context.session.id) });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
  }
});

app.post("/api/projects/:slug/sound/voice-design/auditions/:auditionId/:action", requireLocalSameOriginMutation, async (req, res) => {
  try {
    const context = voiceDesignAuditionContext(req.params.slug, req.params.auditionId);
    const { project, session, audition } = context;
    const action = String(req.params.action || "").toLowerCase();
    if (action === "regenerate") {
      const activeSessionJob = listJobs().find((job) =>
        job.projectSlug === project.slug &&
        job.type === "generate_qwen_voice_design" &&
        job.refs?.sessionId === session.id &&
        ["queued", "running", "cancelling"].includes(String(job.status || ""))
      );
      if (activeSessionJob) {
        return res.status(409).json({
          error: "Wait for or cancel the active Voice Design session before regenerating an audition.",
          job: activeSessionJob
        });
      }
      if (["queued", "loading", "generating", "cancelling"].includes(String(audition.status || ""))) {
        return res.status(409).json({ error: "Wait for or cancel the active audition before regenerating it." });
      }
      const queued = queueVoiceDesignRegeneration(project.slug, session.id, audition.id, req.body || {});
      const job = enqueue({
        type: "generate_qwen_voice_design",
        projectSlug: project.slug,
        label: `Voice Design · ${session.voiceName} regeneration`,
        refs: { sessionId: session.id, auditionId: queued.audition.id, characterId: session.characterId }
      });
      bindVoiceDesignSessionJob(project.slug, session.id, job.id);
      return res.status(202).json({ session: publicVoiceDesignSession(project.slug, session.id), audition: queued.audition, job });
    }
    if (action === "select") {
      selectVoiceDesignAudition(project.slug, session.id, audition.id);
      const library = await saveVoiceDesignAuditionToAssetLibrary(project.slug, session.id, audition.id);
      return res.json({ session: publicVoiceDesignSession(project.slug, session.id), voice: library.voice, asset: library.asset, version: library.version });
    }
    if (action === "save-to-library") {
      const library = await saveVoiceDesignAuditionToAssetLibrary(project.slug, session.id, audition.id);
      return res.json({ session: publicVoiceDesignSession(project.slug, session.id), voice: library.voice, asset: library.asset, version: library.version, alreadySaved: library.alreadySaved });
    }
    if (action === "send-to-index-tts") {
      const hook = buildVoiceDesignIndexTtsHook(project.slug, session.id, audition.id);
      const signal = hook.signalValidation || {};
      const handoff = {
        sourceFile: hook.sourceFile,
        transcript: hook.transcript,
        speaker: hook.speaker,
        name: hook.voiceName,
        characterId: hook.characterId,
        sourceAuditionId: hook.sourceAuditionId,
        sourceEngine: "Qwen3-TTS VoiceDesign",
        sha256: hook.referenceSha256,
        provenance: hook.provenance,
        validation: {
          valid: hook.quality?.passed === true,
          clipping: Number(signal.clippingRatio) > 0.005 || Number(signal.peak) > 1.0001,
          excessiveSilence: Number(signal.silenceRatio) > 0.8 || Number(signal.leadingSilenceSec) > 2 || Number(signal.trailingSilenceSec) > 2,
          singleSpeaker: hook.singleSpeakerValidation === "trusted-generator-contract",
          musicDetected: hook.noMusicValidation === "trusted-generator-contract" ? false : null
        }
      };
      await validateIndexTtsVoiceReferenceFromFile(project.slug, handoff);
      selectVoiceDesignAudition(project.slug, session.id, audition.id);
      const library = await saveVoiceDesignAuditionToAssetLibrary(project.slug, session.id, audition.id);
      const registered = await registerIndexTtsVoiceReferenceFromFile(project.slug, {
        ...handoff,
        assetId: library.asset.id
      });
      const voice = attachVoiceDesignIndexTtsVoiceId(project.slug, library.voice.id, registered.voice.id);
      return res.json({
        session: publicVoiceDesignSession(project.slug, session.id),
        voiceId: registered.voice.id,
        voice,
        indexTtsVoice: registered.voice,
        asset: library.asset
      });
    }
    if (action === "open-folder") {
      const folder = voiceDesignContainingFolder(project.slug, session.id, audition.id);
      if (process.platform === "win32") await execFileAsync("explorer.exe", [folder], { windowsHide: false, timeout: 10_000 });
      else if (process.platform === "darwin") await execFileAsync("open", [folder], { timeout: 10_000 });
      else await execFileAsync("xdg-open", [folder], { timeout: 10_000 });
      return res.json({ opened: true });
    }
    return res.status(404).json({ error: `Unknown Voice Design action: ${req.params.action}` });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
  }
});

function audioAssetMediaUrl(projectSlug, asset) {
  const relative = String(asset?.media?.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relative.startsWith("media/")) return null;
  const mediaPath = relative.slice("media/".length).split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return mediaPath ? `/media/${encodeURIComponent(projectSlug)}/${mediaPath}` : null;
}

function publicProjectAudioAsset(projectSlug, asset) {
  const media = asset?.media || {};
  const provenance = asset?.provenance || {};
  const workflow = provenance.workflow || {};
  const parameters = provenance.parameters || {};
  return {
    ...asset,
    mediaUrl: audioAssetMediaUrl(projectSlug, asset),
    file: media.filename || (media.path ? path.basename(media.path) : null),
    durationSec: media.durationSec ?? null,
    sampleRate: media.sampleRate ?? null,
    channels: media.channels ?? null,
    bytes: media.bytes ?? null,
    sha256: media.sha256 ?? null,
    codec: media.codec ?? null,
    format: media.format ?? null,
    engine: provenance.engine || null,
    modelFamily: provenance.modelFamily || null,
    workflowProfileId: workflow.profileId || null,
    profileId: workflow.profileId || null,
    workflowName: workflow.profileId || null,
    seed: parameters.seed ?? null,
    prompt: provenance.prompt?.original || null,
    allowedActions: [
      asset?.category === "music" ? "save_ost" : "save_library",
      "attach_clip",
      "place_playhead"
    ]
  };
}

function audioCatalogForUi(catalog) {
  return {
    ...catalog,
    profiles: (catalog.profiles || []).map((profile) => ({
      ...profile,
      capabilities: {
        ...(profile.capabilities || {}),
        variationCount: true,
        // Keep enhancer IDs/readiness inspectable, but never advertise a
        // callable control until /sound/develop-prompt exists.
        promptEnhancement: false
      }
    }))
  };
}

function receiveWorkflowJson(req, res, next) {
  workflowJsonUpload.single("workflowFile")(req, res, (error) => {
    if (!error) return next();
    return res.status(error?.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: `Workflow JSON upload failed: ${String(error.message || error)}`,
      code: error?.code || null
    });
  });
}

function parsedWorkflowManagementField(value, label) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); }
  catch { throw Object.assign(new Error(`${label} must be valid JSON`), { statusCode: 400, code: "AUDIO_WORKFLOW_JSON_INVALID" }); }
}

function audioWorkflowImportPayload(req, sourcePath) {
  const manifest = parsedWorkflowManagementField(req.body?.manifest, "manifest") || {};
  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") {
    throw Object.assign(new Error("manifest must be a JSON object"), { statusCode: 400, code: "AUDIO_WORKFLOW_MANIFEST_INVALID" });
  }
  const body = { ...manifest, ...(req.body || {}) };
  delete body.manifest;
  for (const field of [
    "inputNodeBindings", "bindings", "outputNodeBindings", "requiredCustomNodes", "requiredNodes",
    "requiredModelFiles", "requiredModels", "supportedDurationRange", "duration", "capabilities", "outputFormats"
  ]) {
    const parsed = parsedWorkflowManagementField(body[field], field);
    if (parsed !== undefined) body[field] = parsed;
  }
  const uploadedBaseName = req.file?.originalname
    ? path.basename(String(req.file.originalname), path.extname(String(req.file.originalname)))
    : null;
  return {
    ...body,
    sourcePath,
    id: body.id || body.profileId || uploadedBaseName,
    displayName: body.displayName || body.name || uploadedBaseName,
    // Imports always enter the registry disabled. Enabling is a separate,
    // live-validated action so a copied graph can never become runnable just
    // because an upload field said `enabled=true`.
    enabled: false
  };
}

async function importAudioWorkflowFromRequest(req) {
  let stagedSource = null;
  try {
    if (req.file?.buffer?.length) {
      if (path.extname(String(req.file.originalname || "")).toLowerCase() !== ".json") {
        throw Object.assign(new Error("Workflow uploads must be JSON files"), { statusCode: 400, code: "AUDIO_WORKFLOW_FILE_TYPE_INVALID" });
      }
      try { JSON.parse(req.file.buffer.toString("utf8").replace(/^\uFEFF/, "")); }
      catch (error) {
        throw Object.assign(new Error(`Workflow upload is not valid JSON: ${error.message}`), { statusCode: 400, code: "AUDIO_WORKFLOW_JSON_INVALID" });
      }
      const stagingRoot = path.join(AUDIO_WORKFLOW_IMPORT_ROOT, ".staging");
      fs.mkdirSync(stagingRoot, { recursive: true });
      stagedSource = path.join(stagingRoot, `${crypto.randomUUID()}.json`);
      fs.writeFileSync(stagedSource, req.file.buffer, { flag: "wx" });
    }
    const selectedSource = stagedSource || String(req.body?.sourcePath || req.body?.path || "").trim();
    if (!selectedSource) {
      throw Object.assign(new Error("Choose a workflowFile upload or provide sourcePath from the local workflow scan"), { statusCode: 400, code: "AUDIO_WORKFLOW_SOURCE_REQUIRED" });
    }
    if (path.extname(selectedSource).toLowerCase() !== ".json") {
      throw Object.assign(new Error("sourcePath must select a JSON workflow"), { statusCode: 400, code: "AUDIO_WORKFLOW_FILE_TYPE_INVALID" });
    }
    return await importAudioWorkflow(audioWorkflowImportPayload(req, selectedSource));
  } finally {
    // This is only the exact app-created staging file. importAudioWorkflow has
    // already copied it into the durable app-owned imports directory; neither
    // a scanned source workflow nor a user's uploaded original is mutated.
    if (stagedSource) try { if (fs.existsSync(stagedSource)) fs.unlinkSync(stagedSource); } catch {}
  }
}

function audioWorkflowRouteError(res, error) {
  return res.status(Number(error?.statusCode) || 400).json({
    error: String(error.message || error),
    code: error?.code || null,
    profile: error?.profile ? publicAudioWorkflowProfile(error.profile) : undefined
  });
}

app.get("/api/projects/:slug/sound/workflows", async (req, res) => {
  try {
    loadProject(req.params.slug);
    const objectInfo = await getObjectInfo();
    const [catalog, sound] = await Promise.all([
      getAudioWorkflowCatalog({ objectInfo }),
      Promise.resolve(getProjectAudioState(req.params.slug))
    ]);
    const registry = audioCatalogForUi(catalog);
    res.json({
      registry,
      profiles: registry.profiles,
      promptEnhancers: registry.promptEnhancers,
      assets: (sound.assets || []).map((asset) => publicProjectAudioAsset(req.params.slug, asset)),
      generations: sound.audioGenerations || [],
      candidates: registry.excludedDiscoveries || [],
      gpu: gpuLeaseStatus(),
      management: {
        scan: true,
        validate: true,
        import: true,
        importWorkflow: true,
        enableDisable: true,
        rename: true,
        rebind: true,
        copyOnlyImport: true,
        sourceWorkflowsImmutable: true,
        routes: {
          import: `/api/projects/${encodeURIComponent(req.params.slug)}/sound/workflows/import`,
          enableDisable: `/api/projects/${encodeURIComponent(req.params.slug)}/sound/workflows/:profileId/enabled`,
          rename: `/api/projects/${encodeURIComponent(req.params.slug)}/sound/workflows/:profileId/name`,
          rebind: `/api/projects/${encodeURIComponent(req.params.slug)}/sound/workflows/:profileId/rebind`
        }
      }
    });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
  }
});

app.post("/api/projects/:slug/sound/workflows/scan", requireLocalSameOriginMutation, receiveWorkflowJson, async (req, res) => {
  try {
    loadProject(req.params.slug);
    if (req.file?.buffer?.length) {
      const profile = await importAudioWorkflowFromRequest(req);
      return res.status(201).json({
        message: `${profile.displayName} was copied into the app-owned workflow registry in a disabled state. Validate it before enabling.`,
        profile: publicAudioWorkflowProfile(profile),
        copyOnly: true,
        sourceWorkflowMutated: false
      });
    }
    const candidates = scanAudioWorkflowCandidates();
    res.json({ message: `Scanned ${candidates.length} local audio workflow candidate${candidates.length === 1 ? "" : "s"}.`, candidates });
  } catch (error) {
    audioWorkflowRouteError(res, error);
  }
});

app.post("/api/projects/:slug/sound/workflows/validate", requireLocalSameOriginMutation, async (req, res) => {
  try {
    loadProject(req.params.slug);
    const profile = await getAudioWorkflowProfile(req.body?.profileId, { forceObjectInfo: true });
    res.json({ message: `${profile.displayName} is ${profile.readiness?.label || profile.readiness?.status || "validated"}.`, profile: publicAudioWorkflowProfile(profile) });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error), code: error?.code || null });
  }
});

app.post("/api/projects/:slug/sound/workflows/import", requireLocalSameOriginMutation, receiveWorkflowJson, async (req, res) => {
  try {
    loadProject(req.params.slug);
    const profile = await importAudioWorkflowFromRequest(req);
    res.status(201).json({
      message: `${profile.displayName} was copied into the app-owned workflow registry in a disabled state. Validate it before enabling.`,
      profile: publicAudioWorkflowProfile(profile),
      copyOnly: true,
      sourceWorkflowMutated: false
    });
  } catch (error) {
    audioWorkflowRouteError(res, error);
  }
});

app.patch("/api/projects/:slug/sound/workflows/:profileId/enabled", requireLocalSameOriginMutation, async (req, res) => {
  try {
    loadProject(req.params.slug);
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean", code: "AUDIO_WORKFLOW_ENABLED_INVALID" });
    }
    const enabled = req.body.enabled;
    if (enabled) {
      const current = await getAudioWorkflowProfile(req.params.profileId, { forceObjectInfo: true });
      const validationErrors = current.readiness?.errors || [];
      const drift = current.readiness?.drift || [];
      if (validationErrors.length || drift.length) {
        return res.status(409).json({
          error: `${current.displayName} cannot be enabled until validation and binding errors are resolved.`,
          code: "AUDIO_WORKFLOW_NOT_READY",
          profile: publicAudioWorkflowProfile(current)
        });
      }
    }
    const updatedManifest = setAudioWorkflowEnabled(req.params.profileId, enabled);
    if (!enabled) {
      return res.json({
        message: `${updatedManifest.displayName || updatedManifest.id} is now disabled.`,
        profile: publicAudioWorkflowProfile({
          ...updatedManifest,
          enabled: false,
          readiness: { ...(updatedManifest.readiness || {}), enabled: false, status: "disabled", label: "Disabled", ready: false }
        })
      });
    }
    let profile;
    try {
      profile = await getAudioWorkflowProfile(req.params.profileId, { forceObjectInfo: true });
    } catch (error) {
      setAudioWorkflowEnabled(req.params.profileId, false);
      throw error;
    }
    if (enabled && profile.readiness?.ready !== true) {
      setAudioWorkflowEnabled(req.params.profileId, false);
      profile = await getAudioWorkflowProfile(req.params.profileId, { forceObjectInfo: true });
      return res.status(409).json({
        error: `${profile.displayName} did not remain ready after the registry update and was left disabled.`,
        code: "AUDIO_WORKFLOW_NOT_READY",
        profile: publicAudioWorkflowProfile(profile)
      });
    }
    res.json({
      message: `${profile.displayName} is now enabled.`,
      profile: publicAudioWorkflowProfile(profile)
    });
  } catch (error) {
    audioWorkflowRouteError(res, error);
  }
});

app.patch("/api/projects/:slug/sound/workflows/:profileId/name", requireLocalSameOriginMutation, async (req, res) => {
  try {
    loadProject(req.params.slug);
    const profile = renameAudioWorkflowProfile(req.params.profileId, req.body?.displayName ?? req.body?.name);
    res.json({ message: `Workflow renamed to ${profile.displayName}.`, profile: publicAudioWorkflowProfile(profile) });
  } catch (error) {
    audioWorkflowRouteError(res, error);
  }
});

app.post("/api/projects/:slug/sound/workflows/:profileId/rebind", requireLocalSameOriginMutation, async (req, res) => {
  try {
    loadProject(req.params.slug);
    const body = req.body && !Array.isArray(req.body) && typeof req.body === "object" ? req.body : {};
    const profile = await rebindAudioWorkflowProfile(req.params.profileId, {
      inputNodeBindings: body.inputNodeBindings ?? body.bindings,
      outputNodeBindings: body.outputNodeBindings,
      apiWorkflowPath: body.apiWorkflowPath,
      apiWorkflow: body.apiWorkflow
    });
    res.json({
      message: `${profile.displayName} was rebound using its app-owned API workflow and left disabled for explicit validation and enabling. The original source workflow was not changed.`,
      profile: publicAudioWorkflowProfile(profile),
      sourceWorkflowMutated: false
    });
  } catch (error) {
    audioWorkflowRouteError(res, error);
  }
});

app.post(
  "/api/projects/:slug/sound/workflow-generations",
  requireLocalSameOriginMutation,
  (req, res, next) => audioWorkflowUpload.single("referenceFile")(req, res, (error) => {
    if (!error) return next();
    return res.status(error?.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: `Audio workflow upload failed: ${String(error.message || error)}` });
  }),
  async (req, res) => {
    try {
      let parameters = {};
      try { parameters = JSON.parse(String(req.body?.parameters || "{}")); }
      catch { return res.status(400).json({ error: "parameters must be valid JSON" }); }
      if (!parameters || Array.isArray(parameters) || typeof parameters !== "object") return res.status(400).json({ error: "parameters must be a JSON object" });
      if (req.file?.buffer?.length) return res.status(422).json({ error: "The selected enabled audio profiles do not expose reference-audio conditioning." });

      const project = loadProject(req.params.slug);
      const association = parameters.association && typeof parameters.association === "object" ? parameters.association : {};
      const fps = Math.max(1, Number(project.settings?.fps) || 24);
      const advanced = parameters.advanced && typeof parameters.advanced === "object" && !Array.isArray(parameters.advanced) ? parameters.advanced : {};
      const request = {
        ...parameters,
        profileId: String(req.body?.profileId || ""),
        category: String(req.body?.category || parameters.category || ""),
        key: parameters.key ?? parameters.tonalCenter,
        associations: {
          projectSlug: req.params.slug,
          chapterId: association.chapterId || null,
          sceneId: association.sceneId || null,
          clipId: association.clipId || null
        },
        editorial: {
          targetInSec: association.inPointSec ?? null,
          targetOutSec: association.outPointSec ?? null,
          fadeInSec: association.fadeInSec ?? null,
          fadeOutSec: association.fadeOutSec ?? null,
          timelineStartSec: Number.isFinite(Number(association.playheadFrame)) ? Number(association.playheadFrame) / fps : null,
          loop: parameters.loopable === true
        },
        parameters: advanced
      };
      delete request.association;
      delete request.advanced;

      const prepared = await prepareAudioGenerationRecords(req.params.slug, request);
      const job = enqueue({
        type: "generate_audio_workflow",
        projectSlug: req.params.slug,
        profileId: prepared.profileId,
        generationIds: prepared.generationIds,
        label: `Create Sound · ${parameters.name || parameters.title || prepared.profileId}`,
        refs: {
          profileId: prepared.profileId,
          generationIds: prepared.generationIds,
          category: request.category,
          promptIds: {}
        }
      });
      const state = getProjectAudioState(req.params.slug);
      const generationIds = new Set(prepared.generationIds);
      res.status(202).json({
        job,
        jobs: [job],
        generations: (state.audioGenerations || []).filter((generation) => generationIds.has(generation.id))
      });
    } catch (error) {
      res.status(Number(error?.statusCode) || 400).json({
        error: String(error.message || error),
        code: error?.code || null,
        readiness: error?.readiness || null,
        segmentPlan: error?.segmentPlan || null
      });
    }
  }
);

app.patch("/api/projects/:slug/sound/assets/:assetId", requireLocalSameOriginMutation, (req, res) => {
  try {
    const asset = patchProjectAudioAsset(req.params.slug, req.params.assetId, req.body || {});
    res.json({ asset: publicProjectAudioAsset(req.params.slug, asset) });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error), code: error?.code || null });
  }
});

app.delete("/api/projects/:slug/sound/assets/:assetId", requireLocalSameOriginMutation, (req, res) => {
  try {
    const asset = deleteProjectAudioAssetToTrash(req.params.slug, req.params.assetId, { moveFile: true });
    res.json({ deleted: asset, recoverable: true });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error), code: error?.code || null });
  }
});

app.post("/api/projects/:slug/sound/assets/:assetId/actions", requireLocalSameOriginMutation, (req, res) => {
  try {
    const action = String(req.body?.action || "").trim().toLowerCase();
    const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : req.body || {};
    let asset;
    if (action === "save_ost" || action === "save_library") {
      asset = performProjectAudioAssetAction(req.params.slug, req.params.assetId, "approve", { value: true });
    } else if (action === "attach_clip") {
      asset = performProjectAudioAssetAction(req.params.slug, req.params.assetId, "associate", {
        associations: { clipId: payload.clipId || null }
      });
    } else if (action === "place_playhead") {
      const project = loadProject(req.params.slug);
      const fps = Math.max(1, Number(project.settings?.fps) || 24);
      asset = performProjectAudioAssetAction(req.params.slug, req.params.assetId, "editorial", {
        editorial: { timelineStartSec: Math.max(0, Number(payload.playheadFrame) || 0) / fps }
      });
    } else {
      asset = performProjectAudioAssetAction(req.params.slug, req.params.assetId, action, payload);
    }
    res.json({ asset: publicProjectAudioAsset(req.params.slug, asset), placement: buildAudioEditPlacement(asset) });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error), code: error?.code || null });
  }
});

app.get("/api/projects/:slug/sound/index-tts/voices/:voiceId/reference", (req, res) => {
  try {
    const resolved = resolveIndexTtsVoiceReference(req.params.slug, req.params.voiceId);
    res.type(resolved.voice.contentType || "audio/wav");
    res.setHeader("Cache-Control", "private, no-cache");
    res.sendFile(resolved.file);
  } catch (error) {
    res.status(Number(error?.statusCode) || 404).json({ error: String(error.message || error) });
  }
});

app.get("/api/projects/:slug/sound/qwen-tts/voices/:voiceId/reference", (req, res) => {
  try {
    const resolved = resolveQwenTtsVoiceReference(req.params.slug, req.params.voiceId);
    res.type("audio/wav");
    res.setHeader("Cache-Control", "private, no-cache");
    res.sendFile(resolved.file);
  } catch (error) {
    res.status(Number(error?.statusCode) || 404).json({ error: String(error.message || error) });
  }
});

app.post(
  "/api/projects/:slug/sound/qwen-tts/generations",
  requireLocalSameOriginMutation,
  (req, res, next) => qwenTtsAudioUpload.single("referenceAudio")(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge
        ? "Qwen3-TTS reference WAV must be 64 MB or smaller."
        : `Qwen3-TTS upload failed: ${String(error.message || error)}`
    });
  }),
  async (req, res) => {
    try {
      const prepared = await createQwenTtsGeneration(req.params.slug, {
        referenceAudio: req.file || null,
        referenceTranscript: req.body?.referenceTranscript || req.body?.refText,
        voiceId: req.body?.voiceId,
        speaker: req.body?.speaker,
        name: req.body?.name,
        voiceName: req.body?.voiceName || req.body?.name,
        text: req.body?.text,
        style: req.body?.style,
        language: req.body?.language,
        seed: req.body?.seed,
        topK: req.body?.topK,
        topP: req.body?.topP,
        temperature: req.body?.temperature,
        repetitionPenalty: req.body?.repetitionPenalty,
        maxNewTokens: req.body?.maxNewTokens,
        cueId: req.body?.cueId,
        segmentId: req.body?.segmentId,
        attachToCue: req.body?.attachToCue
      });
      const job = enqueue({
        type: "generate_qwen_tts",
        projectSlug: prepared.project.slug,
        label: `Create sound · ${prepared.generation.name}`,
        refs: {
          generationId: prepared.generation.id,
          voiceId: prepared.voice.id,
          cueId: prepared.generation.cueId || null,
          segmentId: prepared.generation.segmentId || null,
          attachToCue: prepared.generation.attachToCue || 0
        }
      });
      const generation = bindQwenTtsGenerationJob(prepared.project.slug, prepared.generation.id, job.id);
      res.status(202).json({ provider: "qwenTts", voice: prepared.voice, generation, job });
    } catch (error) {
      res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
    }
  }
);

app.post(
  "/api/projects/:slug/sound/index-tts/generations",
  requireLocalSameOriginMutation,
  (req, res, next) => indexTtsAudioUpload.single("referenceAudio")(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge
        ? "IndexTTS reference audio must be 64 MB or smaller."
        : `IndexTTS upload failed: ${String(error.message || error)}`
    });
  }),
  async (req, res) => {
    try {
      const prepared = await createIndexTtsGeneration(req.params.slug, {
        referenceAudio: req.file || null,
        voiceId: req.body?.voiceId,
        speaker: req.body?.speaker,
        name: req.body?.name,
        voiceName: req.body?.voiceName || req.body?.name,
        text: req.body?.text,
        style: req.body?.style,
        emotionWeight: req.body?.emotionWeight,
        emotionVector: req.body?.emotionVector,
        language: req.body?.language,
        durationFactor: req.body?.durationFactor,
        seed: req.body?.seed
      });
      const job = enqueue({
        type: "generate_index_tts",
        projectSlug: prepared.project.slug,
        label: `Create sound · ${prepared.generation.name}`,
        refs: { generationId: prepared.generation.id, voiceId: prepared.voice.id }
      });
      const generation = bindIndexTtsGenerationJob(prepared.project.slug, prepared.generation.id, job.id);
      res.status(202).json({ voice: prepared.voice, generation, job });
    } catch (error) {
      res.status(Number(error?.statusCode) || 400).json({ error: String(error.message || error) });
    }
  }
);

app.post("/api/projects/:slug/assets/:assetId/import-image", upload.single("file"), (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!assetManifestCurrent(project)) return res.status(409).json({ error: "Approve the screenplay and refresh its asset manifest before importing an asset version." });
    const asset = project.assets?.items?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: "Image file required" });
    const supported = new Map([
      ["image/png", ".png"],
      ["image/jpeg", ".jpg"],
      ["image/webp", ".webp"]
    ]);
    const extension = supported.get(String(req.file.mimetype || "").toLowerCase());
    if (!extension) return res.status(415).json({ error: "Use a PNG, JPEG, or WebP image." });
    res.json(registerDirectorAssetImage(project, asset, {
      buffer: req.file.buffer,
      extension,
      sourceFileName: req.file.originalname
    }));
  } catch (e) {
    const status = Number(e.statusCode) || (e.code === "DUPLICATE_HASH" ? 409 : 400);
    res.status(status).json({ error: String(e.message), code: e.code, existing: e.existing });
  }
});

app.post("/api/projects/:slug/assets/:assetId/import-audio", upload.single("file"), (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!assetManifestCurrent(project)) return res.status(409).json({ error: "Approve the screenplay and refresh its asset manifest before importing an asset version." });
    const asset = project.assets?.items?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: "Audio file required" });
    const extension = audioUploadExtension(req.file);
    if (!extension) return res.status(415).json({ error: "Use an MP3, WAV, FLAC, M4A, AAC, or OGG audio file." });
    res.json(registerDirectorAssetAudio(project, asset, {
      buffer: req.file.buffer,
      extension,
      sourceFileName: req.file.originalname,
      contentType: req.file.mimetype || null
    }));
  } catch (e) {
    const status = Number(e.statusCode) || (e.code === "DUPLICATE_HASH" ? 409 : 400);
    res.status(status).json({ error: String(e.message), code: e.code, existing: e.existing });
  }
});

app.post("/api/projects/:slug/import-frame", upload.single("file"), (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!skipApproval(project)) {
      return res.status(403).json({ error: "The canonical Project Bin accepts only generated, individually approved Asset Foundry versions. Generate and approve the asset, then use Add Approved to Project Bin." });
    }
    if (!req.file?.buffer?.length) return res.status(400).json({ error: "Image file required" });
    const mimeExt = new Map([["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"]]);
    const fromMime = mimeExt.get(String(req.file.mimetype || "").toLowerCase());
    const fromName = path.extname(String(req.file.originalname || "")).toLowerCase();
    const extension = fromMime || ([".png", ".jpg", ".jpeg", ".webp"].includes(fromName) ? fromName : null);
    if (!extension) return res.status(415).json({ error: "Use a PNG, JPEG, or WebP image." });
    const framesDir = mediaDir(project, "frames");
    fs.mkdirSync(framesDir, { recursive: true });
    const filename = `shorts_${Date.now()}${extension === ".jpeg" ? ".jpg" : extension}`;
    fs.writeFileSync(path.join(framesDir, filename), req.file.buffer);
    const frame = registerFrame(project, filename, req.file.originalname || filename, { source: "shorts-import" });
    saveProject(project);
    res.json({ project, frame });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.delete("/api/projects/:slug/frames/:frameId", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const frame = (project.frames || []).find((item) => item.id === req.params.frameId);
    if (!frame) return res.status(404).json({ error: "Project Bin item not found" });
    const references = frameReferences(project, frame.file);
    if (references.length) return res.status(409).json({ error: "This media is still in use. Remove it from its clip guides first.", references });
    const source = path.resolve(mediaDir(project, "frames"), path.basename(frame.file));
    const framesRoot = path.resolve(mediaDir(project, "frames"));
    if (!source.startsWith(`${framesRoot}${path.sep}`)) return res.status(400).json({ error: "Unsafe frame path" });
    if (!fs.existsSync(source)) return res.status(410).json({ error: "The Project Bin file is already missing, so it cannot be moved to recoverable trash." });
    const trashDir = path.join(projectDir(project.slug), "trash", "frames");
    fs.mkdirSync(trashDir, { recursive: true });
    const trashFile = `${Date.now()}_${path.basename(frame.file)}`;
    const destination = path.join(trashDir, trashFile);
    fs.renameSync(source, destination);
    project.frames = (project.frames || []).filter((item) => item.id !== frame.id);
    project.trash = project.trash || {};
    project.trash.frames = Array.isArray(project.trash.frames) ? project.trash.frames : [];
    project.trash.frames.push({ ...frame, trashFile, deletedAt: new Date().toISOString() });
    saveProject(project);
    res.json({ project, deleted: frame, recoverable: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/frames/:frameId/restore", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const deleted = project.trash?.frames?.find((item) => item.id === req.params.frameId);
    if (!deleted) return res.status(404).json({ error: "Trashed Project Bin item not found" });
    const source = path.join(projectDir(project.slug), "trash", "frames", path.basename(deleted.trashFile));
    const destination = path.join(mediaDir(project, "frames"), path.basename(deleted.file));
    if (!fs.existsSync(source)) return res.status(410).json({ error: "The trashed media file is no longer available" });
    if (fs.existsSync(destination)) return res.status(409).json({ error: "A Project Bin file with this name already exists" });
    fs.renameSync(source, destination);
    const { trashFile, deletedAt, ...frame } = deleted;
    project.frames = [...(project.frames || []), { ...frame, restoredAt: new Date().toISOString() }];
    project.trash.frames = project.trash.frames.filter((item) => item.id !== deleted.id);
    saveProject(project);
    res.json({ project, frame });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/clips", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const { frameFile, name, durationSec, globalPrompt } = req.body || {};
    if (!frameFile) return res.status(400).json({ error: "frameFile required" });
    if (!canonicalFrameCurrent(project, frameFile)) return res.status(409).json({ error: "Only a currently approved Asset Foundry version can create a timeline clip." });
    const framePath = path.join(mediaDir(project, "frames"), frameFile);
    if (!fs.existsSync(framePath)) return res.status(400).json({ error: "frame not found" });
    const clip = makeClip(project, {
      firstFrameFile: frameFile,
      name,
      durationSec: durationSec != null ? clampDuration(durationSec) : undefined,
      globalPrompt
    });
    saveProject(project);
    res.json({ project, clip });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.patch("/api/projects/:slug/clips/:clipId", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const clip = findClip(project, req.params.clipId);
    if (!clip) return res.status(404).json({ error: "clip not found" });
    const patch = req.body || {};
    const fps = project.settings.fps || 24;
    if (patch.globalPrompt != null && String(patch.globalPrompt) !== clip.globalPrompt) {
      clip.globalPrompt = String(patch.globalPrompt);
      markClipDirty(clip);
    }
    if (patch.seed !== undefined) clip.seed = patch.seed;
    if (patch.name != null) clip.name = String(patch.name);
    if (patch.durationSec != null) {
      const old = clip.segments || [];
      clip.durationSec = clampDuration(patch.durationSec);
      clip.segments = normalizeSegments(old, clip.durationSec, project.settings.segmentSec || 2, fps);
      syncGuideAliases(clip, fps);
      markClipDirty(clip);
    }
    if (Array.isArray(patch.segments)) {
      clip.segments = normalizeSegments(patch.segments, clip.durationSec, project.settings.segmentSec || 2, fps);
      markClipDirty(clip);
    }
    if (patch.activeVersion != null) clip.activeVersion = Number(patch.activeVersion);
    if (patch.status != null) clip.status = String(patch.status);
    recomputeStarts(project);
    saveProject(project);
    res.json({ project, clip });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.delete("/api/projects/:slug/clips/:clipId", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    project.sequence.clips = project.sequence.clips.filter((c) => c.id !== req.params.clipId);
    project.sequence.clips.forEach((c, i) => { c.idx = i; });
    recomputeStarts(project);
    saveProject(project);
    res.json({ project });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

// ---------- guide images ----------
app.post("/api/projects/:slug/clips/:clipId/guides", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const clip = findClip(project, req.params.clipId);
    if (!clip) return res.status(404).json({ error: "clip not found" });
    const frameFile = req.body?.frameFile;
    if (!frameFile || !fs.existsSync(path.join(mediaDir(project, "frames"), frameFile))) {
      return res.status(400).json({ error: "Select an imported frame first" });
    }
    if (!canonicalFrameCurrent(project, frameFile)) return res.status(409).json({ error: "Only a currently approved Asset Foundry version can be attached as a guide." });
    const guide = addGuide(project, clip, { ...req.body, file: frameFile, source: "project-bin" });
    saveProject(project);
    res.json({ project, guide });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/clips/:clipId/guides/upload", upload.single("file"), (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!skipApproval(project)) {
      return res.status(403).json({ error: "Direct guide uploads are locked. Generate and approve the image in Asset Foundry, add it to the Project Bin, then attach it to the clip." });
    }
    const clip = findClip(project, req.params.clipId);
    if (!clip) return res.status(404).json({ error: "clip not found" });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: "Image file required" });
    const mimeExt = new Map([["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"]]);
    const fromMime = mimeExt.get(String(req.file.mimetype || "").toLowerCase());
    const fromName = path.extname(String(req.file.originalname || "")).toLowerCase();
    const extension = fromMime || ([".png", ".jpg", ".jpeg", ".webp"].includes(fromName) ? fromName : null);
    if (!extension) return res.status(415).json({ error: "Use a PNG, JPEG, or WebP image." });
    const framesDir = mediaDir(project, "frames");
    fs.mkdirSync(framesDir, { recursive: true });
    const filename = `shorts_guide_${Date.now()}${extension === ".jpeg" ? ".jpg" : extension}`;
    fs.writeFileSync(path.join(framesDir, filename), req.file.buffer);
    registerFrame(project, filename, req.file.originalname || filename, { source: "shorts-import" });
    const guide = addGuide(project, clip, { ...req.body, file: filename, source: "shorts-import" });
    saveProject(project);
    res.json({ project, guide });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/clips/:clipId/guides/generate", (req, res) => {
  try {
    res.status(403).json({ error: "Direct prototype guide generation is locked. Use the approved Asset Foundry pipeline for canonical guide images." });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.patch("/api/projects/:slug/clips/:clipId/guides/:guideId", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const clip = findClip(project, req.params.clipId);
    if (!clip) return res.status(404).json({ error: "clip not found" });
    const guide = findGuide(clip, req.params.guideId);
    if (!guide) return res.status(404).json({ error: "guide not found" });
    const patch = req.body || {};
    if (patch.prompt != null) guide.prompt = String(patch.prompt);
    if (patch.strength != null) guide.strength = Math.min(1, Math.max(0, Number(patch.strength)));
    if (patch.frame != null) guide.frame = Math.round(Number(patch.frame));
    if (patch.seed !== undefined) guide.seed = patch.seed;
    if (patch.role && ["first", "middle", "last"].includes(patch.role)) {
      if (patch.role !== "middle") {
        clip.guides = clip.guides.filter((g) => g.id === guide.id || g.role !== patch.role);
      }
      guide.role = patch.role;
    }
    syncGuideAliases(clip, project.settings.fps || 24);
    markClipDirty(clip, guide.frame);
    saveProject(project);
    res.json({ project, guide });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.delete("/api/projects/:slug/clips/:clipId/guides/:guideId", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const clip = findClip(project, req.params.clipId);
    if (!clip) return res.status(404).json({ error: "clip not found" });
    const guide = findGuide(clip, req.params.guideId);
    clip.guides = (clip.guides || []).filter((g) => g.id !== req.params.guideId);
    syncGuideAliases(clip, project.settings.fps || 24);
    markClipDirty(clip, guide?.frame ?? null);
    saveProject(project);
    res.json({ project });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

// ---------- render ----------
function enqueueRanges(project, clip, ranges, prefix = "Render") {
  const guideCheck = canonicalGuideBindings(project, clip);
  if (!guideCheck.ok) throw new Error(`Render preflight failed: ${guideCheck.error}`);
  const clipFingerprint = clipRenderFingerprint(project, clip);
  return ranges.map((range) => enqueue({
    type: "render_range",
    projectSlug: project.slug,
    label: `${prefix} ${clip.name}`,
    refs: { clipId: clip.id, guideBindings: guideCheck.bindings, clipFingerprint, ...range }
  }));
}

function normalizeH3Mode(mode) {
  return H3_MODES[mode] ? mode : H3_MODE_FIRST;
}

function h3ModeReady(diagnostics, mode) {
  return mode === H3_MODE_REFERENCE ? diagnostics.ref2vaReady : diagnostics.fl2vaReady;
}

function h3ReadinessError(diagnostics, mode) {
  const modeInfo = H3_MODES[mode] || H3_MODES[H3_MODE_FIRST];
  const details = [
    ...(diagnostics?.actionableErrors || []),
    ...(mode === H3_MODE_REFERENCE ? diagnostics?.warnings || [] : [])
  ].filter(Boolean);
  return `${H3_DISPLAY_NAME} ${modeInfo.label} is not ready: ${details.join(" ") || "open MiniMax H3 diagnostics"}`;
}

function enqueueH3Ranges(project, clip, ranges, options = {}) {
  const mode = normalizeH3Mode(options.mode);
  const modeInfo = H3_MODES[mode] || H3_MODES[H3_MODE_FIRST];
  let guideBindings = [];
  if (modeInfo.needsFirst || modeInfo.needsLast) {
    const guideCheck = canonicalGuideBindings(project, clip);
    if (!guideCheck.ok) throw new Error(`MiniMax H3 preflight failed: ${guideCheck.error}. Use currently approved Asset Foundry guides for hard first/last-frame modes.`);
    guideBindings = guideCheck.bindings;
  }
  const fps = project.settings?.fps || 24;
  const clipFingerprint = clipRenderFingerprint(project, clip);
  const splitRanges = splitH3Ranges(ranges, fps);
  return splitRanges.map((range) => enqueue({
    type: "render_h3_range",
    projectSlug: project.slug,
    label: `${H3_DISPLAY_NAME} ${clip.name}`,
    refs: {
      clipId: clip.id,
      guideBindings,
      clipFingerprint,
      h3Mode: mode,
      h3Quality: options.quality || "full",
      h3Aspect: options.aspect || project.settings?.aspectRatio || `${project.settings?.width || 1344}:${project.settings?.height || 768}`,
      h3AudioMode: options.audioMode || "mixed",
      seed: options.seed,
      references: Array.isArray(options.references) ? options.references : [],
      refImageSize: options.refImageSize || "match",
      ...range
    }
  }));
}

app.get("/api/h3/diagnostics", async (req, res) => {
  try {
    res.json(await h3Diagnostics({ force: req.query?.force === "1" || req.query?.force === "true" }));
  } catch (e) {
    res.status(503).json({ error: String(e.message || e) });
  }
});

app.post("/api/projects/:slug/h3/preview", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const clip = findClip(project, req.body?.clipId);
    if (!clip) return res.status(404).json({ error: "clip not found" });
    const ids = req.body?.segmentIds || clip.segments.map((segment) => segment.id);
    const range = groupContiguousSegments(clip.segments, ids)[0] || {
      startFrame: 0,
      endFrame: framesOf(clip.durationSec, project.settings.fps || 24)
    };
    const mode = normalizeH3Mode(req.body?.mode);
    const compiled = compileH3Prompt({
      project,
      clip,
      mode,
      rangeStartFrame: range.startFrame,
      rangeEndFrame: range.endFrame,
      audioMode: req.body?.audioMode || "mixed",
      referenceManifest: req.body?.references || []
    });
    res.json({
      mode,
      prompt: compiled.prompt,
      timing: compiled.timing,
      segmentCount: compiled.localSegments.length,
      guideCount: compiled.localGuides.length
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/projects/:slug/render", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const { clipId, all, dirtyAll, dirty, segmentIds, startFrame, endFrame } = req.body || {};
    const jobsOut = [];
    if (all || dirtyAll) {
      const targets = project.sequence.clips.filter((clip) => {
        const needsRender = !dirtyAll || (clip.segments || []).some((segment) => segment.dirty !== false);
        return needsRender;
      });
      const invalidGuides = targets.map((clip) => canonicalGuideBindings(project, clip)).filter((result) => !result.ok);
      if (invalidGuides.length) {
        return res.status(409).json({
          error: `Render preflight failed: ${invalidGuides.slice(0, 6).map((result) => result.error).join("; ")}${invalidGuides.length > 6 ? "; …" : ""}. Add a currently approved Asset Foundry first frame and replace every stale guide before rendering.`
        });
      }
      for (const clip of targets) {
        if (dirtyAll) {
          const ids = (clip.segments || []).filter((s) => s.dirty !== false).map((s) => s.id);
          const ranges = groupContiguousSegments(clip.segments, ids);
          jobsOut.push(...enqueueRanges(project, clip, ranges, "Render dirty"));
        } else {
          jobsOut.push(...enqueueRanges(project, clip, [{
            startFrame: 0,
            endFrame: framesOf(clip.durationSec, project.settings.fps || 24),
            segmentIds: (clip.segments || []).map((s) => s.id)
          }]));
        }
      }
    } else {
      if (!clipId) return res.status(400).json({ error: "clipId or all required" });
      const clip = findClip(project, clipId);
      if (!clip) return res.status(404).json({ error: "clip not found" });
      const guideCheck = canonicalGuideBindings(project, clip);
      if (!guideCheck.ok) return res.status(409).json({ error: `Render preflight failed: ${guideCheck.error}. Use a currently approved Asset Foundry guide.` });
      let ranges = [];
      if (startFrame != null && endFrame != null) {
        const ids = (clip.segments || [])
          .filter((s) => s.endFrame > Number(startFrame) && s.startFrame < Number(endFrame))
          .map((s) => s.id);
        ranges = [{ startFrame: Number(startFrame), endFrame: Number(endFrame), segmentIds: ids }];
      } else {
        const ids = Array.isArray(segmentIds) && segmentIds.length
          ? segmentIds
          : dirty
            ? (clip.segments || []).filter((s) => s.dirty !== false).map((s) => s.id)
            : (clip.segments || []).map((s) => s.id);
        ranges = groupContiguousSegments(clip.segments, ids);
      }
      if (!ranges.length) return res.status(400).json({ error: "No segments selected for rendering" });
      jobsOut.push(...enqueueRanges(project, clip, ranges, dirty ? "Render dirty" : "Render selection"));
    }
    res.json({ jobs: jobsOut });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/render-h3", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const mode = normalizeH3Mode(req.body?.mode);
    const diagnostics = await h3Diagnostics();
    if (!h3ModeReady(diagnostics, mode)) {
      return res.status(409).json({ error: h3ReadinessError(diagnostics, mode), diagnostics });
    }
    const { clipId, all, dirtyAll, dirty, segmentIds, startFrame, endFrame } = req.body || {};
    const options = {
      mode,
      quality: req.body?.quality || "full",
      aspect: req.body?.aspect,
      audioMode: req.body?.audioMode || "mixed",
      seed: req.body?.seed,
      references: req.body?.references || [],
      refImageSize: req.body?.refImageSize || "match"
    };
    const jobsOut = [];
    if (all || dirtyAll) {
      const targets = project.sequence.clips.filter((clip) => {
        const needsRender = !dirtyAll || (clip.segments || []).some((segment) => segment.dirty !== false);
        return needsRender;
      });
      for (const clip of targets) {
        if (dirtyAll) {
          const ids = (clip.segments || []).filter((segment) => segment.dirty !== false).map((segment) => segment.id);
          const ranges = groupContiguousSegments(clip.segments, ids);
          jobsOut.push(...enqueueH3Ranges(project, clip, ranges, options));
        } else {
          jobsOut.push(...enqueueH3Ranges(project, clip, [{
            startFrame: 0,
            endFrame: framesOf(clip.durationSec, project.settings.fps || 24),
            segmentIds: (clip.segments || []).map((segment) => segment.id)
          }], options));
        }
      }
    } else {
      if (!clipId) return res.status(400).json({ error: "clipId or all required" });
      const clip = findClip(project, clipId);
      if (!clip) return res.status(404).json({ error: "clip not found" });
      let ranges = [];
      if (startFrame != null && endFrame != null) {
        const ids = (clip.segments || [])
          .filter((segment) => segment.endFrame > Number(startFrame) && segment.startFrame < Number(endFrame))
          .map((segment) => segment.id);
        ranges = [{ startFrame: Number(startFrame), endFrame: Number(endFrame), segmentIds: ids }];
      } else {
        const ids = Array.isArray(segmentIds) && segmentIds.length
          ? segmentIds
          : dirty
            ? (clip.segments || []).filter((segment) => segment.dirty !== false).map((segment) => segment.id)
            : (clip.segments || []).map((segment) => segment.id);
        ranges = groupContiguousSegments(clip.segments, ids);
      }
      if (!ranges.length) return res.status(400).json({ error: "No segments selected for MiniMax H3 rendering" });
      jobsOut.push(...enqueueH3Ranges(project, clip, ranges, options));
    }
    res.json({ jobs: jobsOut, diagnostics });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/projects/:slug/clips/:clipId/assemble", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const clip = findClip(project, req.params.clipId);
    if (!clip) return res.status(404).json({ error: "clip not found" });
    const job = enqueue({
      type: "assemble_clip",
      projectSlug: project.slug,
      label: `Assemble ${clip.name}`,
      refs: { clipId: clip.id }
    });
    res.json({ job });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/preview-prompt", async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    const clip = findClip(project, req.body?.clipId);
    if (!clip) return res.status(404).json({ error: "clip not found" });
    const ids = req.body?.segmentIds || clip.segments.map((s) => s.id);
    const range = groupContiguousSegments(clip.segments, ids)[0] || {
      startFrame: 0,
      endFrame: framesOf(clip.durationSec, project.settings.fps || 24)
    };
    const result = await fillI2vPrompt({
      globalPrompt: clip.globalPrompt,
      segments: clip.segments,
      guides: clip.guides,
      rangeStartFrame: range.startFrame,
      rangeEndFrame: range.endFrame,
      durationSec: clip.durationSec,
      fps: project.settings.fps,
      width: project.settings.width,
      height: project.settings.height,
      ingredients: project.settings.ingredients,
      objectInfo: await getObjectInfo()
    });
    res.json({
      warnings: result.warnings,
      requestedFrames: result.requestedFrames,
      generationFrames: result.generationFrames,
      segmentCount: result.localSegments.length,
      guideCount: result.localGuides.length,
      ingredients: result.ingredients
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

// ---------- sequence editor ----------
app.get("/api/projects/:slug/editor", (req, res) => {
  try {
    res.json(editorWorkspace(req.params.slug));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.put("/api/projects/:slug/editor/sequence", requireLocalSameOriginMutation, (req, res) => {
  try {
    const document = saveEditSequence(req.params.slug, req.body?.sequence, req.body?.expectedRevision);
    res.json({ document });
  } catch (e) {
    const status = e?.code === "EDIT_REVISION_CONFLICT" ? 409 : 400;
    res.status(status).json({ error: String(e.message || e), current: e?.current || undefined });
  }
});

app.post("/api/projects/:slug/editor/media/probe", requireLocalSameOriginMutation, async (req, res) => {
  try {
    res.json({ results: await probeEditorMedia(req.params.slug, req.body?.files) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/projects/:slug/editor/media/audio", requireLocalSameOriginMutation, editorAudioUpload.single("file"), async (req, res) => {
  try {
    res.json({ imported: await importEditorAudio(req.params.slug, req.file) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/projects/:slug/editor/media/video", requireLocalSameOriginMutation, editorVideoUpload.single("file"), async (req, res) => {
  try {
    res.json({ imported: await importEditorVideo(req.params.slug, req.file) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/projects/:slug/editor/export", requireLocalSameOriginMutation, (req, res) => {
  try {
    const document = loadEditDocument(req.params.slug);
    if (req.body?.revision != null && Number(req.body.revision) !== Number(document.revision)) {
      return res.status(409).json({ error: `Save or reload the latest edit before exporting (current revision ${document.revision}).`, current: document });
    }
    if (!document.sequence?.videoClips?.length) return res.status(400).json({ error: "Add at least one video clip before exporting." });
    const job = enqueue({
      type: "build_edit_master",
      projectSlug: document.projectSlug,
      label: `Export edit · ${document.sequence.name}`,
      refs: {
        revision: document.revision,
        sequenceId: document.sequence.id,
        videoClips: document.sequence.videoClips.length,
        audioClips: document.sequence.audioClips.length
      },
      sequenceSnapshot: document.sequence
    });
    res.json({ job, document });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// ---------- score and master ----------
app.post("/api/projects/:slug/score/upload", upload.single("file"), async (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (!req.file) return res.status(400).json({ error: "audio file required" });
    const clean = safeName(req.file.originalname, "score.wav");
    const filename = `${Date.now()}_${clean}`;
    const disk = path.join(mediaDir(project, "audio"), filename);
    fs.writeFileSync(disk, req.file.buffer);
    const info = await probeMedia(disk).catch(() => ({ durationSec: 0 }));
    const version = Math.max(0, ...(project.score.versions || []).map((v) => Number(v.v) || 0)) + 1;
    project.score.versions.push({
      v: version,
      file: filename,
      name: clean,
      createdAt: new Date().toISOString(),
      durationSec: info.durationSec,
      source: "upload"
    });
    project.score.activeVersion = version;
    project.score.mode = "upload";
    project.score.enabled = true;
    saveProject(project);
    res.json({ project, version });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/score/generate", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (req.body?.score) project.score = { ...project.score, ...req.body.score };
    saveProject(project);
    const job = enqueue({
      type: "generate_score",
      projectSlug: project.slug,
      label: `Generate score · ${project.name}`,
      refs: {}
    });
    res.json({ job });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/master/build", (req, res) => {
  try {
    const project = loadProject(req.params.slug);
    if (req.body?.score) project.score = { ...project.score, ...req.body.score };
    const bookends = normalizeBookends(
      req.body?.bookends || project.settings?.bookends,
      project.name
    );
    project.settings.bookends = bookends;
    saveProject(project);
    const job = enqueue({
      type: "build_master",
      projectSlug: project.slug,
      label: `Build final master · ${project.name}`,
      refs: { bookends }
    });
    res.json({ job });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.get("/api/queue", (_req, res) => res.json({ jobs: listJobs() }));
app.post("/api/queue/:id/cancel", requireLocalSameOriginMutation, (req, res) => {
  if (isExternalQueueJobId(req.params.id)) {
    return res.status(409).json({
      ok: false,
      readOnly: true,
      error: "This H02 Qwen job is managed by its standalone supervisor."
    });
  }
  return res.json({ ok: cancelJob(req.params.id) });
});

// ---------- media ----------
app.get("/media/:slug/:kind/*", (req, res) => {
  const disk = resolveProjectMediaFile(PROJECTS_DIR, req.params.slug, req.params.kind, req.params[0]);
  if (!disk || !fs.existsSync(disk) || !fs.statSync(disk).isFile()) return res.status(404).end();
  res.sendFile(disk);
});

// ---------- client ----------
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res, next) => {
    if (!isClientWorkspacePath(req.path)) return next();
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html><html><body style="background:#0b0e14;color:#ddd;font-family:sans-serif;padding:2rem">
      <h1>Premiere316</h1><p>Run <code>npm run build</code>, then restart.</p>
      <p>API health: <a href="/api/health">/api/health</a></p><p>${PACKAGE_ROOT}</p>
    </body></html>`);
  });
}

const comfySocketServer = new WebSocketServer({ noServer: true });
const premiereServer = app.listen(PORT, HOST, () => {
  console.log(`Premiere316 → http://${HOST}:${PORT}`);
  console.log(`  ComfyUI     → ${COMFY_URL}`);
  console.log(`  projects    → ${PROJECTS_DIR}`);
  setTimeout(() => { try { startComfyOutputIngest(); } catch (e) { console.warn('[comfy-8188 ingest]', e); } }, 1500);
});

premiereServer.on("upgrade", (request, socket, head) => {
  if (!isLoopbackRequest(request) || !isPermittedLocalGatewayRequest({
    host: request.headers.host,
    origin: request.headers.origin,
    protocol: "http"
  })) {
    socket.destroy();
    return;
  }
  let incoming;
  try {
    incoming = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
  } catch {
    socket.destroy();
    return;
  }
  const prefix = "/integrations/comfyui";
  if (!incoming.pathname.startsWith(`${prefix}/`)) {
    socket.destroy();
    return;
  }

  const suffix = `${incoming.pathname.slice(prefix.length) || "/"}${incoming.search}`;
  const target = fixedUpstreamWebSocketUrl(COMFY_URL, suffix);
  comfySocketServer.handleUpgrade(request, socket, head, (client) => {
    const protocolHeader = request.headers["sec-websocket-protocol"];
    const protocols = typeof protocolHeader === "string"
      ? protocolHeader.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
    const options = { headers: { origin: new URL(COMFY_URL).origin } };
    const upstream = protocols.length
      ? new WebSocket(target, protocols, options)
      : new WebSocket(target, options);
    const pending = [];
    const closePeer = (peer, code, reason) => {
      if (peer.readyState === WebSocket.CONNECTING) return peer.terminate();
      if (peer.readyState === WebSocket.OPEN) peer.close(...webSocketCloseArguments(code, reason));
    };

    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push([data, isBinary]);
    });
    upstream.on("open", () => {
      for (const [data, isBinary] of pending.splice(0)) upstream.send(data, { binary: isBinary });
    });
    upstream.on("message", (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    client.on("close", (code, reason) => {
      closePeer(upstream, code, reason);
    });
    upstream.on("close", (code, reason) => {
      closePeer(client, code, reason);
    });
    upstream.on("error", () => {
      if (client.readyState === WebSocket.OPEN) client.close(1011, "ComfyUI gateway unavailable");
    });
    client.on("error", () => {
      if (upstream.readyState === WebSocket.OPEN) upstream.close(1011, "Premiere316 client disconnected");
    });
  });
});
