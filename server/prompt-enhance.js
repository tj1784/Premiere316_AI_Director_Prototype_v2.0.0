// Premiere316 — Grok-agent prompt enhancement for Asset Foundry.
// Prepares per-asset work packages, fans out parallel `grok -p` agents,
// then merges enhanced prompts into project.json / workflows / manifest.
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import os from "os";
import { projectDir } from "./paths.js";
import { loadProject, saveProject } from "./projects.js";
import { saveAssetPackageFiles, withAssetPromptHeader } from "./assets.js";

const GROK_BIN = process.env.GROK_EXECUTABLE
  || path.join(process.env.USERPROFILE || os.homedir(), ".grok", "bin", "grok.exe");
const DEFAULT_CONCURRENCY = Math.max(2, Math.min(12, Number(process.env.PREMIERE316_PROMPT_ENHANCE_CONCURRENCY) || 8));
const AGENT_TIMEOUT_MS = Number(process.env.PREMIERE316_PROMPT_ENHANCE_TIMEOUT_MS) || 12 * 60 * 1000;

/** @type {Map<string, any>} */
const activeJobs = new Map();
/** @type {Map<string, Promise<any>>} */
const applyLocks = new Map();

async function withApplyLock(slug, fn) {
  const previous = applyLocks.get(slug) || Promise.resolve();
  const run = previous.catch(() => {}).then(() => fn());
  // Keep the chain alive for the next waiter even if this run fails.
  applyLocks.set(slug, run.catch(() => {}));
  try {
    return await run;
  } finally {
    if (applyLocks.get(slug) === run || applyLocks.get(slug)?.then === run.then) {
      // leave settled promise; next call still serializes correctly
    }
  }
}

const CHARACTER_PREFIX = `Create a four-view cinematic character ingredients sheet showing the same person in frontal three-quarter portrait, full-body, side profile, and rear-head/costume view. Lock facial identity, age, ethnicity, hairline, complete crown and rear hair, costume construction, body proportions, hands, scars, wounds, and carried props across every panel. One face exists only on the front of the head. Photorealistic live-action production reference, physically coherent lighting, exact anatomy, clean hands, consistent scale and materials, no captions, no logos, no watermarks, no borders, and no written or graphical elements.`;

const STILL_PREFIX = `Photorealistic live-action production reference, physically coherent lighting, exact anatomy, clean hands, consistent scale and materials, no captions, no logos, no watermarks, no borders, and no written or graphical elements.`;

function enhanceRoot(slug) {
  return path.join(projectDir(slug), "production", "prompt-enhancement");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, String(text ?? ""), "utf8");
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function getPromptEnhanceStatus(slug) {
  const job = activeJobs.get(slug);
  if (job) {
    const { _controller, ...publicJob } = job;
    return {
      ...publicJob,
      active: ["queued", "running", "cancelling"].includes(String(job.status || ""))
    };
  }
  const persisted = readJson(path.join(enhanceRoot(slug), "last-run.json"), null);
  return persisted
    ? { ...persisted, active: false }
    : { status: "idle", active: false, completed: 0, total: 0, message: "No prompt enhance run yet." };
}

export function grokCliAvailable() {
  return fs.existsSync(GROK_BIN);
}

function buildScreenplayBible(project) {
  const title = project.name || project.slug || "Untitled";
  const settings = project.screenplay?.settings || {};
  const md = String(project.screenplay?.markdown || "");
  const excerpt = md.length > 12000 ? `${md.slice(0, 12000)}\n\n…[truncated for agent context]…` : md;
  return `# ${title} — Continuity Bible for Prompt Enhancement

## Project
- **Slug:** ${project.slug}
- **Title:** ${title}
- **Genre:** ${settings.genre || "Cinematic"}
- **Runtime minutes:** ${settings.runtimeMinutes || "n/a"}
- **Aspect ratio:** ${settings.aspectRatio || project.settings?.width && project.settings?.height ? `${project.settings.width}:${project.settings.height}` : "2.39:1"}
- **Tone / palette:** ${settings.tone || settings.concept || "Match the screenplay"}
- **Visual model target:** Krea 2 Turbo (Qwen3-VL) for cinematic stills/characters; Flux2 Klein for props when assigned; Qwen3-TTS for voice; ACE-Step for music; LTX-native for diegetic sound

## Screenplay source (authoritative)
${excerpt || "_No screenplay markdown saved._"}

## Hard continuity rules
- Photoreal live-action production reference language for image models
- No modern objects, logos, watermarks, UI, borders, or captions in image prompts
- One face only on the front of the head for character sheets
- Preserve blood maps, costume damage, prop states, and location light temperatures from the screenplay
- Title-card graphic assets stay typography-safe (do not invent unreadable diffusion text)
`;
}

function buildKreaGuide() {
  return `# Krea 2 Turbo Prompt Enhancement Guide

## Output schema
Write JSON to the path given in the agent prompt with:
\`\`\`json
{
  "id": "asset-id",
  "category": "...",
  "mediaType": "image|audio|instruction|graphic",
  "workflowId": "...",
  "sourcePrompt": "core creative prompt WITHOUT boilerplate prefix",
  "prompt": "full final prompt INCLUDING correct category prefix + sourcePrompt",
  "sampleText": "for voice assets only; else empty string",
  "notes": "1-2 sentence continuity notes"
}
\`\`\`

## Prefixes
### Character ingredients / wardrobe ingredients (\`krea2-character-ingredients-fp8\`)
${CHARACTER_PREFIX}

### Cinematic still / location / atmosphere / extra / guide-frame (\`krea2-cinematic-still-fp8\`)
${STILL_PREFIX}

### Prop / artifact (\`flux2-klein-9b-prop-fp8\`)
${STILL_PREFIX}
Append at end of body: Neutral production reference framing, the complete object visible, accurate materials and scale, no labels or text.

### Voice
prompt/sourcePrompt = rich TTS instruct (timbre, age, accent, dynamics). sampleText = iconic screenplay line.

### Sound
Full diegetic audio direction: layers, frequency, spatial image, attack/decay, exclusions.

### Music
Instrumental-only score direction: instruments, dynamics, emotional arc, no lyrics, no modern pop drums.

### Graphic title card
Keep exact title typography intent; do not invent random subtitles.

## Quality bar
- Hero characters/locations: 450–900 words of concrete cinematic prose in sourcePrompt
- Props/FX: 250–500 words
- Replace thin meta stubs completely from the screenplay
- Natural sentences (Krea 2 / Qwen3-VL), not tag salad
`;
}

function prepareEnhancementWorkspace(project, assetIds) {
  const root = enhanceRoot(project.slug);
  const perAsset = path.join(root, "per-asset");
  const enhanced = path.join(root, "enhanced");
  ensureDir(perAsset);
  ensureDir(enhanced);

  writeText(path.join(root, "SCREENPLAY_BIBLE.md"), buildScreenplayBible(project));
  writeText(path.join(root, "KREA2_PROMPT_GUIDE.md"), buildKreaGuide());
  writeText(path.join(root, "screenplay.md"), String(project.screenplay?.markdown || ""));

  const items = (project.assets?.items || []).filter((item) => assetIds.includes(item.id));
  for (const asset of items) {
    writeText(path.join(perAsset, `${asset.id}.json`), JSON.stringify({
      id: asset.id,
      category: asset.category,
      name: asset.name,
      variant: asset.variant,
      mediaType: asset.mediaType,
      workflowId: asset.workflowId,
      status: asset.status,
      continuity: asset.continuity || [],
      dependencies: asset.dependencies || [],
      prompt: asset.prompt || "",
      sourcePrompt: asset.sourcePrompt || "",
      sampleText: asset.sampleText || ""
    }, null, 2));
  }

  writeText(path.join(root, "asset-ids.json"), JSON.stringify(assetIds, null, 2));
  return { root, perAsset, enhanced, items };
}

function findPromptNodeId(wf) {
  for (const [id, node] of Object.entries(wf || {})) {
    const ct = node?.class_type;
    if (ct === "CLIPTextEncode" && node?.inputs && "text" in node.inputs) return id;
    if (ct === "FB_Qwen3TTSVoiceDesign" && node?.inputs) return id;
    if (ct && /AceStep|TextEncodeAce/i.test(ct) && node?.inputs) return id;
  }
  return null;
}

function applyEnhancedToWorkflow(projectSlug, assetId, prompt, sampleText, sourcePrompt) {
  const workflowsDir = path.join(projectDir(projectSlug), "workflows");
  const apiPath = path.join(workflowsDir, `${assetId}.api.json`);
  const recipePath = path.join(workflowsDir, `${assetId}.recipe.json`);
  if (fs.existsSync(apiPath)) {
    const wf = readJson(apiPath, null);
    if (!wf) return false;
    const nodeId = findPromptNodeId(wf);
    if (!nodeId) return false;
    const node = wf[nodeId];
    if (node.class_type === "CLIPTextEncode") node.inputs.text = prompt;
    else if (node.class_type === "FB_Qwen3TTSVoiceDesign") {
      node.inputs.instruct = prompt;
      if (sampleText) node.inputs.text = sampleText;
    } else {
      if ("text" in (node.inputs || {})) node.inputs.text = prompt;
      if ("prompt" in (node.inputs || {})) node.inputs.prompt = prompt;
      if ("tags" in (node.inputs || {})) node.inputs.tags = prompt;
    }
    fs.writeFileSync(apiPath, JSON.stringify(wf, null, 2));
    return true;
  }
  if (fs.existsSync(recipePath)) {
    const rec = readJson(recipePath, {}) || {};
    rec.prompt = prompt;
    if (sourcePrompt) rec.sourcePrompt = sourcePrompt;
    fs.writeFileSync(recipePath, JSON.stringify(rec, null, 2));
    return true;
  }
  return false;
}

function applyAudioDirectionSidecar(projectSlug, assetId, prompt, sourcePrompt) {
  const mediaAssets = path.join(projectDir(projectSlug), "media", "assets");
  if (!fs.existsSync(mediaAssets)) return;
  const files = fs.readdirSync(mediaAssets)
    .filter((name) => name.startsWith(assetId) && name.endsWith(".audio-direction.txt"))
    .sort()
    .reverse();
  if (!files[0]) return;
  const body = `# Audio Direction — ${assetId}\n# Enhanced for production (Grok agents / LTX-native diegetic notes)\n\n${prompt}\n\n## Source body\n${sourcePrompt || ""}\n`;
  fs.writeFileSync(path.join(mediaAssets, files[0]), body, "utf8");
}

export function applyEnhancedPrompts(project, enhancedDir, { assetIds = null } = {}) {
  if (!fs.existsSync(enhancedDir)) return { updated: 0, ids: [] };
  const requested = Array.isArray(assetIds) ? new Set(assetIds.map(String)) : null;
  const files = fs.readdirSync(enhancedDir).filter((name) => {
    if (!name.endsWith(".json")) return false;
    return !requested || requested.has(path.basename(name, ".json"));
  });
  const byId = new Map((project.assets?.items || []).map((item, index) => [item.id, index]));
  const updated = [];
  const now = new Date().toISOString();

  for (const file of files) {
    const enh = readJson(path.join(enhancedDir, file), null);
    if (!enh) continue;
    const id = enh.id || path.basename(file, ".json");
    const index = byId.get(id);
    if (index == null) continue;
    const item = project.assets.items[index];
    const rawPrompt = String(enh.prompt || "").trim();
    if (!rawPrompt) continue;
    const prompt = withAssetPromptHeader(item, rawPrompt);
    const sourcePrompt = String(enh.sourcePrompt || "").trim();
    const sampleText = enh.sampleText != null ? String(enh.sampleText) : "";
    item.sourcePrompt = sourcePrompt || item.sourcePrompt || "";
    item.prompt = prompt;
    if (sampleText) item.sampleText = sampleText;
    item.promptEnhancedAt = now;
    item.promptEnhancement = "grok-agents-krea2-max-detail-v1";
    item.updatedAt = now;
    // Generated versions are immutable provenance. A newly enhanced direction
    // belongs only to the current asset and must be generated as a new version.
    enh.prompt = prompt;
    enh.promptHeader = item.promptHeader;
    fs.writeFileSync(path.join(enhancedDir, file), JSON.stringify(enh, null, 2));
    applyEnhancedToWorkflow(project.slug, id, prompt, sampleText, sourcePrompt);
    applyAudioDirectionSidecar(project.slug, id, prompt, sourcePrompt);
    updated.push(id);
  }

  if (project.assets) {
    project.assets.generatedAt = now;
    project.assets.promptEnhance = {
      lastAppliedAt: now,
      updatedCount: updated.length,
      engine: "grok-agents"
    };
  }
  project.updatedAt = now;
  saveAssetPackageFiles(project);
  saveProject(project);
  return { updated: updated.length, ids: updated };
}

function buildAgentPrompt({ projectRoot, assetId }) {
  const rootPosix = projectRoot.replace(/\\/g, "/");
  return [
    "You are a senior cinematic prompt engineer for Premiere316 Asset Foundry.",
    "Your ONLY job is to enhance ONE asset prompt with maximum production detail for Krea 2 Turbo / Qwen3-VL (or the asset's assigned workflow).",
    "",
    "MANDATORY READS (use read tools before writing):",
    `1) ${rootPosix}/production/prompt-enhancement/SCREENPLAY_BIBLE.md`,
    `2) ${rootPosix}/production/prompt-enhancement/KREA2_PROMPT_GUIDE.md`,
    `3) ${rootPosix}/production/prompt-enhancement/per-asset/${assetId}.json`,
    `4) Optionally skim ${rootPosix}/screenplay.md or the bible for dialogue/action.`,
    "",
    `ASSET ID: ${assetId}`,
    "",
    "TASK:",
    "- Rewrite a richly detailed sourcePrompt grounded in the screenplay (replace thin meta stubs completely).",
    "- Build full prompt with the correct category prefix from KREA2_PROMPT_GUIDE.md.",
    "- The FIRST line of prompt must exactly match promptHeader from the per-asset JSON. Keep that line in ALL CAPS and place one blank line after it.",
    "- For voice assets set sampleText to the best iconic line; otherwise sampleText empty string.",
    `- Write JSON to EXACT path: ${rootPosix}/production/prompt-enhancement/enhanced/${assetId}.json`,
    "- Schema: id, category, mediaType, workflowId, sourcePrompt, prompt, sampleText, notes",
    "- Aim for maximum useful detail: hero image assets 450-900 words body; props/fx 250-500; audio/voice/music thoroughly specified.",
    "- Photoreal live-action biblical/cinematic epic tone as appropriate. No modern objects. No logos/text in image prompts. One face only on front of head for characters.",
    "- After writing, re-read your output file to confirm it exists.",
    "Return a one-line summary: OK assetId source_chars=N prompt_chars=N"
  ].join("\n");
}

function runGrokAgent({ cwd, prompt, signal, timeoutMs = AGENT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(GROK_BIN)) {
      reject(new Error(`Grok CLI not found at ${GROK_BIN}. Install Grok Build or set GROK_EXECUTABLE.`));
      return;
    }
    const args = [
      "-p", prompt,
      "--cwd", cwd,
      "--always-approve",
      "--permission-mode", "bypassPermissions",
      "--output-format", "plain",
      "--max-turns", "24"
    ];
    const child = spawn(GROK_BIN, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      try { child.kill(); } catch {}
      settled = true;
      reject(new Error(`Grok agent timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onAbort = () => {
      try { child.kill(); } catch {}
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => { stdout += String(chunk || ""); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk || ""); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      if (signal?.aborted) {
        reject(Object.assign(new Error("Prompt enhance cancelled"), { code: "ENHANCE_CANCELLED" }));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Grok agent exited ${code}: ${(stderr || stdout).slice(-1200)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => runner()));
  return results;
}

function persistJob(slug, job) {
  try {
    writeText(path.join(enhanceRoot(slug), "last-run.json"), JSON.stringify(job, null, 2));
  } catch {}
}

export async function startPromptEnhance(project, {
  assetIds = null,
  concurrency = DEFAULT_CONCURRENCY,
  onProgress = null
} = {}) {
  const slug = project.slug;
  const existing = activeJobs.get(slug);
  if (existing && ["queued", "running"].includes(existing.status)) {
    throw new Error("A Grok prompt enhance run is already active for this project.");
  }
  if (!project.assets?.items?.length) throw new Error("Build production assets before enhancing prompts.");
  if (!grokCliAvailable()) {
    throw new Error(`Grok CLI not found at ${GROK_BIN}. Install Grok Build CLI so Premiere316 can spawn agents.`);
  }

  const allIds = project.assets.items.map((item) => item.id);
  const targets = Array.isArray(assetIds) && assetIds.length
    ? allIds.filter((id) => assetIds.includes(id))
    : allIds;
  if (!targets.length) throw new Error("No matching assets to enhance.");

  const controller = new AbortController();
  const job = {
    id: `enhance_${Date.now().toString(36)}`,
    projectSlug: slug,
    status: "running",
    stage: "Preparing enhancement workspace",
    message: `Spawning up to ${Math.min(concurrency, targets.length)} parallel Grok agents…`,
    total: targets.length,
    completed: 0,
    failed: 0,
    okIds: [],
    failedIds: [],
    concurrency: Math.min(concurrency, targets.length),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    engine: "grok-cli-parallel-agents",
    grokBin: GROK_BIN
  };
  job._controller = controller;
  activeJobs.set(slug, job);
  persistJob(slug, { ...job, _controller: undefined });
  onProgress?.(job);

  const projectRoot = projectDir(slug);
  prepareEnhancementWorkspace(project, targets);

  try {
    job.stage = "Running Grok agents";
    await mapPool(targets, job.concurrency, async (assetId) => {
      if (controller.signal.aborted) return { assetId, ok: false, error: "cancelled" };
      try {
        await runGrokAgent({
          cwd: projectRoot,
          prompt: buildAgentPrompt({ projectRoot, assetId }),
          signal: controller.signal
        });
        const outPath = path.join(enhanceRoot(slug), "enhanced", `${assetId}.json`);
        const enh = readJson(outPath, null);
        const ok = Boolean(enh?.prompt && String(enh.prompt).trim());
        if (!ok) throw new Error("Agent finished without a usable enhanced prompt file");
        job.completed += 1;
        job.okIds.push(assetId);
        job.message = `Enhanced ${job.completed}/${job.total} · last ok: ${assetId}`;
        // Incremental apply so the UI sees live updates (serialized per project).
        await withApplyLock(slug, async () => {
          const live = loadProject(slug);
          applyEnhancedPrompts(live, path.join(enhanceRoot(slug), "enhanced"), { assetIds: [assetId] });
        });
        onProgress?.(job);
        persistJob(slug, { ...job, _controller: undefined });
        return { assetId, ok: true };
      } catch (error) {
        if (error?.code === "ENHANCE_CANCELLED" || controller.signal.aborted) {
          return { assetId, ok: false, error: "cancelled" };
        }
        job.failed += 1;
        job.failedIds.push({ id: assetId, error: String(error.message || error) });
        job.message = `Enhanced ${job.completed}/${job.total} · failures ${job.failed} · last fail: ${assetId}`;
        onProgress?.(job);
        persistJob(slug, { ...job, _controller: undefined });
        return { assetId, ok: false, error: String(error.message || error) };
      }
    });

    if (controller.signal.aborted) {
      job.status = "cancelled";
      job.stage = "Cancelled";
      job.error = null;
    } else {
      const live = loadProject(slug);
      const applied = applyEnhancedPrompts(live, path.join(enhanceRoot(slug), "enhanced"), { assetIds: job.okIds });
      job.applied = applied.updated;
      job.status = job.failed && !job.completed ? "error" : "done";
      job.stage = job.status === "done" ? "Complete" : "Finished with errors";
      job.message = job.status === "done"
        ? `Enhanced and applied ${job.completed}/${job.total} prompts via Grok agents.`
        : `Applied ${job.completed} prompts; ${job.failed} agent failures.`;
      if (job.failed && !job.completed) job.error = job.failedIds[0]?.error || "All agents failed";
    }
  } catch (error) {
    job.status = "error";
    job.stage = "Failed";
    job.error = String(error.message || error);
    job.message = job.error;
  } finally {
    job.finishedAt = new Date().toISOString();
    delete job._controller;
    activeJobs.set(slug, job);
    persistJob(slug, job);
    onProgress?.(job);
  }

  return job;
}

export function cancelPromptEnhance(slug) {
  const job = activeJobs.get(slug);
  if (!job || !["queued", "running"].includes(job.status)) return false;
  job.status = "cancelling";
  job.stage = "Cancelling Grok agents…";
  job.message = "Cancellation requested…";
  try { job._controller?.abort(); } catch {}
  persistJob(slug, { ...job, _controller: undefined });
  return true;
}
