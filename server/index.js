// Premiere316 — AI video-generation timeline over ComfyUI / LTX Director.
import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { execFile } from "child_process";
import { promisify } from "util";
import { comfyAlive, COMFY_URL, getObjectInfo } from "./comfy.js";
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
  syncGuideAliases
} from "./projects.js";
import { enqueue, listJobs, cancelJob, cancelAssetJobs } from "./queue.js";
import {
  fillI2vPrompt,
  normalizeSegments,
  clampDuration,
  framesOf,
  groupContiguousSegments
} from "./timeline.js";
import { ffmpegAvailable, probeMedia } from "./ffmpeg.js";
import { normalizeBookends } from "./bookends.js";
import { PACKAGE_ROOT, PROJECTS_DIR, CLIENT_DIST, projectDir } from "./paths.js";
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
  assetApprovalCurrent,
  assetGenerationFingerprint,
  assetVersionFingerprint,
  assetVersionFilesCurrent,
  buildAssetPackage,
  getAssetWorkflowCatalog,
  promoteAssetToFrame,
  saveAssetPackageFiles,
  reconcileAssetGenerationState,
  withAssetPromptHeader,
  registerDirectorAssetImage,
  validateAssetWorkflow
} from "./assets.js";
import { premierePiAgent, PREMIERE_PI_MODEL } from "./pi-agent.js";
import {
  cancelPromptEnhance,
  getPromptEnhanceStatus,
  grokCliAvailable,
  startPromptEnhance
} from "./prompt-enhance.js";

const PORT = process.env.PORT || 8789;
const app = express();
app.use(express.json({ limit: "100mb" }));

const execFileAsync = promisify(execFile);
const LMS_EXECUTABLE = process.env.LMS_EXECUTABLE || path.join(process.env.USERPROFILE || "", ".lmstudio", "bin", "lms.exe");
const GPU_HANDOFF_CONFIRMATION = "UNLOAD_QWEN_AND_CANCEL_ACTIVE_GENERATION";
const COMFY_RESTART_SCRIPT = path.join(PACKAGE_ROOT, "BlokeyUI", "restart_premiere316_engine.ps1");
let comfyRestarting = false;
let comfyRestartState = { status: "idle", startedAt: null, finishedAt: null, error: null, detail: null };

function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || "");
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
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
  const [comfy, ffmpeg, screenplay] = await Promise.all([
    comfyAlive(),
    ffmpegAvailable(),
    screenplayModelHealth()
  ]);
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
    app: "premiere316",
    capabilities: {
      selectedRangeRender: true,
      guideUpload: false,
      ingredientsICLoRA: true,
      dedicatedComfyUI: false,
      dedicatedComfyRestart: process.platform === "win32" && /:8188$/.test(COMFY_URL) && fs.existsSync(COMFY_RESTART_SCRIPT),
      screenplayGeneration: screenplay.online && screenplay.modelAvailable,
      screenplayStreamingChat: screenplay.online && screenplay.modelAvailable,
      piExpertOrchestrator: true,
      piExpertForcedSameModelWorker: true,
      piExpertModel: PREMIERE_PI_MODEL,
      assetApprovalGate: true,
      exactAssetVersionApproval: true,
      explicitLmStudioGpuHandoff: true,
      recoverableProjectBinTrash: true,
      guideGenerator: "asset-foundry-only",
      scoreGenerator: ffmpeg ? "prototype-fallback" : "unavailable",
      masterAssembly: ffmpeg,
      deterministicMasterBookends: ffmpeg
    }
  });
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
  if (!(["127.0.0.1", "localhost"].includes(comfyUrl.hostname) && comfyUrl.port === "8188")) {
    return res.status(409).json({ error: "Restart is available only for the routed local Sineforge ComfyUI on port 8188." });
  }
  if (process.platform !== "win32" || !fs.existsSync(COMFY_RESTART_SCRIPT)) {
    return res.status(501).json({ error: "The dedicated ComfyUI restart helper is unavailable on this installation." });
  }
  if (comfyRestarting) {
    return res.status(409).json({ error: "Dedicated ComfyUI is already restarting." });
  }

  const activePremiereJobs = listJobs().filter((job) => ["queued", "running", "cancelling"].includes(String(job.status || "")));
  if (activePremiereJobs.length) {
    return res.status(409).json({
      error: `Restart blocked: Premiere316 has ${activePremiereJobs.length} queued or running generation job(s). Stop or finish them first.`
    });
  }

  const online = await comfyAlive();
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
    status: "restarting",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    detail: null
  };
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  void execFileAsync(powershell, [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", COMFY_RESTART_SCRIPT
    ], {
      cwd: path.dirname(COMFY_RESTART_SCRIPT),
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 1024 * 1024
    })
    .then(async ({ stdout }) => {
      if (!await comfyAlive()) throw new Error("The restart helper exited, but ComfyUI did not pass its health check.");
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
        error: `Dedicated ComfyUI restart failed: ${String(error.message || error)}`,
        detail: null
      };
    })
    .finally(() => { comfyRestarting = false; });

  return res.status(202).json({ ok: true, restarting: true, comfyUrl: COMFY_URL, state: comfyRestartState });
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

// ---------- projects ----------
app.get("/api/projects", (_req, res) => res.json({ projects: listProjects() }));

app.post("/api/projects", (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "name required" });
    res.json({ project: createProject(name.trim()) });
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
      screenplay: existing.screenplay,
      assets: existing.assets,
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
  const screenplay = project?.screenplay;
  const revision = currentScreenplayRevision(project);
  return Boolean(
    screenplay?.approval?.status === "approved" &&
    screenplay.approval.screenplayRevision &&
    screenplay.approval.screenplayRevision === revision
  );
}

function assetManifestCurrent(project) {
  const revision = currentScreenplayRevision(project);
  return Boolean(screenplayApprovalCurrent(project) && revision && project?.assets?.screenplayHash === revision);
}

function canonicalFrameCurrent(project, frameOrFile) {
  const frame = typeof frameOrFile === "string"
    ? (project.frames || []).find((item) => item.file === frameOrFile)
    : frameOrFile;
  if (!frame || frame.source !== "asset-foundry-approved" || !frame.assetId) return false;
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
    const beforeFingerprint = assetGenerationFingerprint(asset);
    const allowed = ["name", "variant", "prompt", "sampleText", "workflowId", "seed", "durationSec", "bpm", "status", "dependencies", "continuity"];
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) asset[key] = req.body[key];
    asset.prompt = withAssetPromptHeader(asset, asset.prompt);
    if (asset.workflowId && !ASSET_WORKFLOWS.some((workflow) => workflow.id === asset.workflowId)) {
      return res.status(400).json({ error: `Unknown asset workflow: ${asset.workflowId}` });
    }
    const catalog = await getAssetWorkflowCatalog();
    const state = catalog.find((workflow) => workflow.id === asset.workflowId);
    asset.workflow = state ? { id: state.id, label: state.label, model: state.model, ready: state.ready, availableNow: state.availableNow, reason: state.runtimeWarning || state.reason, gpu: state.gpu, minimumFreeVramGb: state.minimumFreeVramGb } : asset.workflow;
    if (assetGenerationFingerprint(asset) !== beforeFingerprint) asset.approval = null;
    asset.updatedAt = new Date().toISOString();
    saveAssetPackageFiles(project);
    saveProject(project);
    res.json({ project, asset });
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
    if (!screenplayApprovalCurrent(project)) return res.status(409).json({ error: "Asset generation is locked until the current screenplay revision is approved." });
    if (!assetManifestCurrent(project)) return res.status(409).json({ error: "The production asset manifest is stale. Refresh Assets from the approved screenplay before generating." });
    const asset = project.assets?.items?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    const existingJob = listJobs().find((job) =>
      job.projectSlug === project.slug &&
      job.type === "generate_asset" &&
      job.refs?.assetId === asset.id &&
      ["queued", "running", "cancelling"].includes(job.status)
    );
    if (existingJob) return res.json({ project, job: existingJob, alreadyQueued: true });
    const catalog = await getAssetWorkflowCatalog();
    const state = catalog.find((workflow) => workflow.id === asset.workflowId);
    if (!state?.ready) return res.status(409).json({ error: state?.reason || "The selected workflow is not ready" });
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
    res.json({ project, jobs, queued: jobs.length, skipped: project.assets.items.length - targets.length });
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
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:slug/import-frame", (req, res) => {
  try {
    res.status(403).json({ error: "The canonical Project Bin accepts only generated, individually approved Asset Foundry versions. Generate and approve the asset, then use Add Approved to Project Bin." });
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

app.post("/api/projects/:slug/clips/:clipId/guides/upload", (req, res) => {
  try {
    res.status(403).json({ error: "Direct guide uploads are locked. Generate and approve the image in Asset Foundry, add it to the Project Bin, then attach it to the clip." });
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
app.post("/api/queue/:id/cancel", (req, res) => res.json({ ok: cancelJob(req.params.id) }));

// ---------- media ----------
app.get("/media/:slug/:kind/:file", (req, res) => {
  const allowed = new Set(["frames", "clips", "audio", "assets", "masters"]);
  if (!allowed.has(req.params.kind)) return res.status(404).end();
  const file = path.basename(req.params.file);
  const disk = path.join(projectDir(req.params.slug), "media", req.params.kind, file);
  if (!fs.existsSync(disk)) return res.status(404).end();
  res.sendFile(disk);
});

// ---------- client ----------
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/media")) return next();
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

app.listen(PORT, () => {
  console.log(`Premiere316 → http://127.0.0.1:${PORT}`);
  console.log(`  ComfyUI     → ${COMFY_URL}`);
  console.log(`  projects    → ${PROJECTS_DIR}`);
});
