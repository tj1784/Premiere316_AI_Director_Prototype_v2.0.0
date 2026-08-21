import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { projectDir } from "../server/paths.js";
import { loadStoryboard, saveStoryboard, storyboardPath, validateStoryboard } from "../server/storyboard.js";

const PROJECT_SLUG = "harrowing_of_hell";
const CLIP_ID = "H01-S01-C01";
const EDIT_ID = "h01_s01_c01_swordless_descent_v1";
const SWORD_ASSET_ID = "artifact-sword-of-light-christs-weapon-close-up";
const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling", "finalizing"]);

const FRAME_EDITS = [
  {
    segmentId: "segment-h01-s01-c01-01",
    frameId: "frame-h01-s01-c01-first",
    baseName: "H01-S01-C01_first",
    source: "C:/Users/Blokey/.codex/generated_images/019ff5ae-9a66-7780-b64a-a4e825c98d24/exec-4b58ff4d-11ca-453e-beb3-3215b728fb4f.png",
    expectedSha256: "635d277bdde525b0ca5896d81c72e1dc9b01850db5caf91178433e64252e1489",
    expectedBytes: 1853310,
    expectedWidth: 1935,
    expectedHeight: 813,
    prompt: "Begin exactly from the supplied frame. Jesus continues an extremely slow upright descent in supernatural near-stasis. Head remains above feet; neither knee steps. His long hair and only the loose edges of the heavy burial linen undulate gently upward. Both wounded hands remain empty and relaxed beside his body; no weapon or weapon-shaped light appears. Camera makes a very slow rear three-quarter arc without crossing his face. End upright and calm as the stasis begins to break."
  },
  {
    segmentId: "segment-h01-s01-c01-02",
    frameId: "frame-segment-h01-s01-c01-02",
    baseName: "H01-S01-C01_seg02",
    source: "C:/Users/Blokey/.codex/generated_images/019ff5ae-9a66-7780-b64a-a4e825c98d24/exec-8b327dc4-6281-46b8-a68c-3a9025ac27f4.png",
    expectedSha256: "a9211e625ba9441f51e08ea812379daabf85a9886e7983c7c91dba79aaaf58bd",
    expectedBytes: 1805045,
    expectedWidth: 1935,
    expectedHeight: 813,
    prompt: "Begin exactly from the supplied frame. Jesus completes one controlled pitch into a straight head-first vertical fall and accelerates downward. He never flies horizontally or approaches the lens. Hair and attached linen stream toward his feet; both wounded hands remain empty, anatomically stable, and aligned with the fall, with no weapon or weapon-shaped light. Camera descends beside and behind him with strong parallax, never revealing his face, then brakes near the end."
  },
  {
    segmentId: "segment-h01-s01-c01-03",
    frameId: "frame-segment-h01-s01-c01-03",
    baseName: "H01-S01-C01_seg03",
    source: "C:/Users/Blokey/.codex/generated_images/019ff5ae-9a66-7780-b64a-a4e825c98d24/exec-6de2d81f-4001-4532-b185-56ba171e9962.png",
    expectedSha256: "961084130d203e497962352e0579baba5be6000a9e8e59974932d27240caf769",
    expectedBytes: 1642108,
    expectedWidth: 1933,
    expectedHeight: 813,
    prompt: "Begin exactly from the supplied overhead frame. Camera remains absolutely stationary. Jesus continues falling head-first directly away along the centerline, shrinking from a small white-robed human silhouette to a tiny dim ivory point. No weapon or weapon-shaped light appears. Layered black vapor passes between him and lens. End when his body is completely swallowed by darkness."
  },
  {
    segmentId: "segment-h01-s01-c01-04",
    frameId: "frame-segment-h01-s01-c01-04",
    baseName: "H01-S01-C01_seg04",
    source: "C:/Users/Blokey/.codex/generated_images/019ff5ae-9a66-7780-b64a-a4e825c98d24/exec-8abbc686-7530-4817-b1f0-7b7365b0ea86.png",
    expectedSha256: "3aa142eea170f232ce002b87f4f0a0d4df3dc7acc57de9cea95531276b887646",
    expectedBytes: 1571079,
    expectedWidth: 1931,
    expectedHeight: 814,
    prompt: "Begin exactly from the empty-shaft frame. Camera launches straight down after the tiny dim ivory-white trace of burial linen in one continuous acceleration, passing basalt, hanging chains, vapor and ash with strong depth parallax. It gradually reacquires Jesus from very close behind and beside his head and shoulders; hair and shoulder conceal his face. Both wounded hands remain empty as his linen and hair stream with the plunge; no sword, blade, hilt, or weapon-shaped light appears. End in a stable close rear-side falling view."
  }
];

const SWORDLESS_LOCK = "Throughout the descent, Jesus is unarmed: both wounded hands stay empty, and no sword, blade, hilt, weapon, weapon-shaped light, or weapon reflection appears.";

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function promptHash(value) {
  return sha256Buffer(Buffer.from(String(value), "utf8"));
}

function pngInfo(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Swordless source is not a PNG");
  }
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error("Swordless PNG is missing IHDR");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  if (bitDepth !== 8 || colorType !== 2) throw new Error(`Swordless PNG must be RGB24, received bitDepth=${bitDepth} colorType=${colorType}`);
  const aspect = width / height;
  if (aspect < 2.35 || aspect > 2.42) throw new Error(`Swordless PNG aspect ${aspect.toFixed(4)} is outside the 2.39:1 guide tolerance`);
  return { width, height, bitDepth, colorType, aspect };
}

function activeProjectJobs() {
  const matches = [];
  for (const filename of ["generation-jobs.json", "director-generation-jobs.json"]) {
    const file = path.join(projectDir(PROJECT_SLUG), filename);
    if (!fs.existsSync(file)) continue;
    let ledger;
    try { ledger = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { continue; }
    for (const job of ledger.jobs || []) {
      const clipId = job.refs?.clipId || job.refs?.binding?.clipId;
      if (clipId === CLIP_ID && ACTIVE_STATUSES.has(job.status)) matches.push(`${filename}:${job.id}:${job.status}`);
    }
  }
  return matches;
}

function nextVersion(mediaDirectory, baseName, frame) {
  let maximum = Math.max(0, ...(frame.generatedVersions || []).map((item) => Number(item.v) || 0));
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`^${escaped}\\.v(\\d+)(?:\\..+)?\\.(?:png|jpe?g|webp)$`, "i");
  for (const filename of fs.readdirSync(mediaDirectory)) {
    const match = filename.match(expression);
    if (match) maximum = Math.max(maximum, Number(match[1]) || 0);
  }
  return maximum + 1;
}

function deepHash(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(value), "utf8"));
}

function nonTargetSnapshot(storyboard) {
  const planId = storyboard.clips[CLIP_ID].videoPlanId;
  const segmentIds = new Set(storyboard.videoPlans[planId].segmentIds);
  const frameIds = new Set([...segmentIds].map((id) => storyboard.segments[id].frameId));
  return {
    root: Object.fromEntries(Object.entries(storyboard).filter(([key]) => !["updatedAt", "imports", "clips", "videoPlans", "segments", "frames", "referenceBindings"].includes(key))),
    clips: Object.fromEntries(Object.entries(storyboard.clips).filter(([id]) => id !== CLIP_ID)),
    videoPlans: Object.fromEntries(Object.entries(storyboard.videoPlans).filter(([id]) => id !== planId)),
    segments: Object.fromEntries(Object.entries(storyboard.segments).filter(([id]) => !segmentIds.has(id))),
    frames: Object.fromEntries(Object.entries(storyboard.frames).filter(([id]) => !frameIds.has(id))),
    referenceBindings: Object.fromEntries(Object.entries(storyboard.referenceBindings).filter(([, binding]) => !(binding?.targetKind === "frame" && frameIds.has(binding.targetId))))
  };
}

function buildGlobalPrompt(clip, priorPrompt) {
  const visualLock = priorPrompt.match(/GLOBAL VISUAL LOCK\n([\s\S]*?)\n\nCONTINUITY LOCKS/)?.[1]?.trim()
    || "Maximum photorealistic live-action biblical epic with stable anatomy, tactile cloth, real basalt and iron, natural lens behavior, restrained motion blur, high dynamic range, and delicate film grain.";
  const locks = clip.continuityLocks.map((lock) => `- ${lock}`).join("\n");
  return [
    `PREMIERE316 LTX-2.5 SEGMENTED IMAGE-TO-VIDEO — ${clip.id}`,
    "",
    "GENERATION MODE",
    "Generate each authored segment independently from its supplied first frame. The supplied first frame is authoritative for composition, identity, wardrobe, geography, lighting, and physical state. Begin exactly from that image, animate only the selected segment prompt, and do not execute actions from any other segment.",
    "",
    "FORMAT",
    `- Clip duration: ${clip.durationFrames / 24} seconds across authored segments`,
    `- Master frames: ${clip.durationFrames} at 24 fps`,
    "- Master framing: 2.39:1 cinematic widescreen, normalized to the configured 1152×480 delivery canvas",
    "- Render method: one I2V job per segment; preserve the authored segment boundaries",
    "",
    "GLOBAL VISUAL LOCK",
    visualLock,
    "",
    "CONTINUITY LOCKS",
    locks,
    "",
    "PERFORMANCE AND AUDIO",
    `- ${clip.dialogueAnchor || "No dialogue."}`,
    `- ${clip.audioPlan?.instruction || "Generate only grounded ambience and physical sound appropriate to the selected segment."}`,
    "",
    "SEGMENT EXECUTION",
    "Use only the selected segment's local positive motion prompt. Treat source asset names as provenance only; do not reproduce contact-sheet borders, labels, panel layouts, or unrelated subjects. Preserve a stable final composition for editorial assembly."
  ].join("\n");
}

function assertNoPositiveSwordDirection(storyboard) {
  const clip = storyboard.clips[CLIP_ID];
  const plan = storyboard.videoPlans[clip.videoPlanId];
  const positive = [plan.globalPrompt, ...plan.segmentIds.map((id) => storyboard.segments[id].prompt), ...(clip.continuityLocks || [])].join("\n");
  for (const forbidden of [/luminous golden sword remains/i, /single golden sword/i, /single right-hand sword/i, /body and sword shape/i, /carries exactly one luminous golden sword/i]) {
    if (forbidden.test(positive)) throw new Error(`A stale positive sword direction remains: ${forbidden}`);
  }
  if (!/Jesus is unarmed/i.test(plan.globalPrompt) || !/both wounded hands stay empty/i.test(plan.globalPrompt)) {
    throw new Error("Swordless continuity lock is missing from the active global prompt");
  }
}

function verifyState(storyboard, mediaDirectory, receipt) {
  validateStoryboard(storyboard, PROJECT_SLUG);
  const expectedFrameIds = FRAME_EDITS.map((item) => item.frameId);
  const receivedFrameIds = [...(receipt.frameIds || [])];
  if (receipt.frames?.length !== FRAME_EDITS.length || receivedFrameIds.join(",") !== expectedFrameIds.join(",")) {
    throw new Error("Swordless correction receipt does not contain the exact four C01 frames");
  }
  const backup = path.resolve(projectDir(PROJECT_SLUG), String(receipt.backup || ""));
  const projectRoot = path.resolve(projectDir(PROJECT_SLUG));
  if (!backup.startsWith(`${projectRoot}${path.sep}`) || !fs.existsSync(backup) || sha256File(backup) !== receipt.sourceStoryboardSha256) {
    throw new Error("Swordless correction backup is missing or does not match its source storyboard hash");
  }
  const clip = storyboard.clips[CLIP_ID];
  const plan = storyboard.videoPlans[clip.videoPlanId];
  if (clip.generationMode !== "i2v_segmented_first_frames" || plan.generationMode !== "i2v_segmented_first_frames") {
    throw new Error("C01 is not in segmented I2V mode");
  }
  if (plan.segmentIds.length !== 4) throw new Error("C01 no longer contains four authored segments");
  for (const item of receipt.frames) {
    const segment = storyboard.segments[item.segmentId];
    const frame = storyboard.frames[item.frameId];
    if (segment.prompt !== item.prompt || segment.type !== "image" || segment.frameId !== item.frameId) throw new Error(`Swordless segment mismatch: ${item.segmentId}`);
    if (frame.activeGeneratedVersion !== item.version || frame.generatedFile !== item.filename) throw new Error(`Swordless frame is not active: ${item.frameId}`);
    if (frame.generatedInputPath !== `media/storyboard/${item.filename}` || frame.generatedAssetVersionId !== `${item.frameId}:v${item.version}` || frame.inputHash !== item.sha256) {
      throw new Error(`Swordless active frame fields differ for ${item.frameId}`);
    }
    if ((frame.references || []).length !== item.activeReferenceCount || item.activeReferenceCount !== 5 || (frame.references || []).some((reference) => reference.assetId === SWORD_ASSET_ID)) {
      throw new Error(`Swordless reference set differs for ${item.frameId}`);
    }
    const version = (frame.generatedVersions || []).find((entry) => Number(entry.v) === item.version && entry.file === item.filename);
    if (!version || version.prompt !== item.prompt || version.fileHashes?.[0]?.sha256 !== item.sha256 || Number(version.fileHashes?.[0]?.bytes) !== Number(item.bytes)) {
      throw new Error(`Swordless frame version is missing or inconsistent: ${item.frameId}`);
    }
    const disk = path.join(mediaDirectory, item.filename);
    if (!fs.existsSync(disk) || fs.statSync(disk).size !== item.bytes || sha256File(disk) !== item.sha256) throw new Error(`Swordless media failed hash verification: ${item.filename}`);
  }
  if (Object.values(storyboard.referenceBindings).some((binding) => binding?.targetKind === "frame" && receipt.frameIds.includes(binding.targetId) && binding.assetId === SWORD_ASSET_ID)) {
    throw new Error("A top-level sword prop binding remains on a C01 frame");
  }
  for (const item of receipt.frames) {
    const frame = storyboard.frames[item.frameId];
    for (const reference of frame.references || []) {
      const binding = storyboard.referenceBindings[reference.id];
      if (!binding || binding.assetId !== reference.assetId || binding.targetId !== frame.id || Number(binding.order) !== Number(reference.order)) {
        throw new Error(`Swordless frame reference is not mirrored globally: ${reference.id}`);
      }
    }
  }
  if (plan.localPrompts !== plan.segmentIds.map((id) => storyboard.segments[id].prompt).join(" | ")) throw new Error("C01 localPrompts is stale");
  const timelineById = new Map((plan.timelineData?.segments || []).map((segment) => [segment.id, segment]));
  for (const item of receipt.frames) {
    const timeline = timelineById.get(item.segmentId);
    if (!timeline || timeline.prompt !== item.prompt || timeline.fileName !== item.filename || timeline.type !== "image") {
      throw new Error(`Swordless timeline mirror is stale: ${item.segmentId}`);
    }
  }
  if (!/sword, blade, sword hilt, weapon/i.test(plan.negativePrompt || "")) throw new Error("Swordless negative prompt is missing the weapon exclusions");
  assertNoPositiveSwordDirection(storyboard);
  return true;
}

export function updateH01C01SwordlessDescent({ now = new Date(), dryRun = false } = {}) {
  const storyboardFile = storyboardPath(PROJECT_SLUG);
  const current = loadStoryboard(PROJECT_SLUG);
  const existingReceipt = current.imports?.[EDIT_ID];
  const mediaDirectory = path.join(projectDir(PROJECT_SLUG), "media", "storyboard");
  if (existingReceipt) {
    verifyState(current, mediaDirectory, existingReceipt);
    return { idempotent: true, storyboard: current, receipt: existingReceipt, backup: existingReceipt.backup };
  }

  const active = activeProjectJobs();
  if (active.length) throw new Error(`Cannot update C01 while generation is active: ${active.join(", ")}`);
  const clip = current.clips[CLIP_ID];
  const plan = current.videoPlans[clip.videoPlanId];
  if (ACTIVE_STATUSES.has(clip.renderStatus) || ACTIVE_STATUSES.has(plan.status) || plan.activeRenderPromptId) {
    throw new Error("Cannot update C01 while its render attempt is active");
  }
  if (plan.segmentIds.join(",") !== FRAME_EDITS.map((item) => item.segmentId).join(",")) throw new Error("C01 segment order changed unexpectedly");

  const sourceRecords = FRAME_EDITS.map((item) => {
    if (!fs.existsSync(item.source) || !fs.statSync(item.source).isFile()) throw new Error(`Swordless source is missing: ${item.source}`);
    const buffer = fs.readFileSync(item.source);
    const info = pngInfo(buffer);
    const sha256 = sha256Buffer(buffer);
    if (buffer.byteLength !== item.expectedBytes || sha256 !== item.expectedSha256 || info.width !== item.expectedWidth || info.height !== item.expectedHeight) {
      throw new Error(`Swordless source changed after visual approval: ${path.basename(item.source)}`);
    }
    return { ...item, buffer, info, sha256 };
  });

  const startingSha256 = sha256File(storyboardFile);
  const beforeNonTargetHash = deepHash(nonTargetSnapshot(current));
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupDirectory = path.join(projectDir(PROJECT_SLUG), "production", "backups");
  const backup = path.join(backupDirectory, `storyboard.before-h01-c01-swordless.${stamp}.json`);
  fs.mkdirSync(backupDirectory, { recursive: true });
  fs.copyFileSync(storyboardFile, backup, fs.constants.COPYFILE_EXCL);

  const next = structuredClone(current);
  const nextClip = next.clips[CLIP_ID];
  const nextPlan = next.videoPlans[nextClip.videoPlanId];
  const createdFiles = [];
  let storyboardSaved = false;
  const receipt = {
    editId: EDIT_ID,
    clipId: CLIP_ID,
    frameIds: FRAME_EDITS.map((item) => item.frameId),
    source: "codex_builtin_image_edit_sword_removal",
    instruction: "Remove the sword, hilt, blade, weapon glow, and sword reflection while preserving the source frame composition and Jesus with empty hands.",
    editedAt: now.toISOString(),
    backup: path.relative(projectDir(PROJECT_SLUG), backup).replace(/\\/g, "/"),
    sourceStoryboardSha256: startingSha256,
    frames: []
  };

  if (dryRun) {
    fs.unlinkSync(backup);
    return { dryRun: true, idempotent: false, storyboard: current, receipt, backup: null };
  }

  try {
    for (const item of sourceRecords) {
      const frame = next.frames[item.frameId];
      const segment = next.segments[item.segmentId];
      if (!frame || segment?.frameId !== item.frameId) throw new Error(`C01 frame binding is missing: ${item.segmentId}`);
      const version = nextVersion(mediaDirectory, item.baseName, frame);
      const filename = `${item.baseName}.v${version}.swordless.png`;
      const destination = path.join(mediaDirectory, filename);
      fs.writeFileSync(destination, item.buffer, { flag: "wx" });
      createdFiles.push(destination);
      const references = (frame.references || []).filter((reference) => reference.assetId !== SWORD_ASSET_ID);
      if (!references.length || references.length !== (frame.references || []).length - 1) throw new Error(`Expected one sword reference on ${item.frameId}`);
      for (const [bindingId, binding] of Object.entries(next.referenceBindings)) {
        if (binding?.targetKind === "frame" && binding.targetId === item.frameId && binding.assetId === SWORD_ASSET_ID) delete next.referenceBindings[bindingId];
      }
      references.forEach((reference, index) => {
        next.referenceBindings[reference.id] = { ...reference, order: index + 1 };
      });
      const versionRecord = {
        v: version,
        files: [filename],
        file: filename,
        mediaType: "image",
        source: "codex_builtin_image_edit_sword_removal",
        sourceFrameFile: frame.generatedFile,
        editInstruction: receipt.instruction,
        prompt: item.prompt,
        promptHash: promptHash(item.prompt),
        width: item.info.width,
        height: item.info.height,
        workflowId: null,
        workflowHash: null,
        provenanceType: "built_in_image_editor_revision",
        sourceReferenceAssets: references,
        fileHashes: [{ file: filename, sha256: item.sha256, bytes: item.buffer.byteLength, extension: ".png" }],
        createdAt: now.toISOString()
      };
      frame.generatedVersions = [...(frame.generatedVersions || []), versionRecord];
      frame.activeGeneratedVersion = version;
      frame.generatedFile = filename;
      frame.generatedInputPath = `media/storyboard/${filename}`;
      frame.generatedAssetId = frame.id;
      frame.generatedAssetVersionId = `${frame.id}:v${version}`;
      frame.inputHash = item.sha256;
      frame.prompt = item.prompt;
      frame.negativePrompt = `${String(frame.negativePrompt || nextPlan.negativePrompt || "").replace(/(?:^|,\s*)duplicate sword(?=,|$)/i, "").trim()}, sword, blade, sword hilt, weapon, weapon-shaped light, sword reflection, duplicate weapon`.replace(/^,\s*/, "");
      frame.references = references.map((reference, index) => ({ ...reference, order: index + 1 }));
      frame.status = "generated";
      frame.lastError = null;
      frame.activeEditProvenance = {
        editId: EDIT_ID,
        source: receipt.source,
        priorActiveFile: versionRecord.sourceFrameFile,
        instruction: receipt.instruction,
        editedAt: now.toISOString()
      };
      segment.prompt = item.prompt;
      segment.status = "ready";
      receipt.frames.push({
        segmentId: item.segmentId,
        frameId: item.frameId,
        sourceFile: item.source.replace(/\\/g, "/"),
        filename,
        version,
        width: item.info.width,
        height: item.info.height,
        bytes: item.buffer.byteLength,
        sha256: item.sha256,
        prompt: item.prompt,
        promptHash: promptHash(item.prompt),
        activeReferenceCount: references.length
      });
    }

    nextClip.continuityLocks = [
      SWORDLESS_LOCK,
      ...(nextClip.continuityLocks || []).filter((lock) => !/sword|weapon|unarmed|empty hand|blade|hilt/i.test(lock))
    ];
    nextClip.renderStatus = "not_started";
    delete nextClip.renderError;
    nextPlan.globalPrompt = buildGlobalPrompt(nextClip, nextPlan.globalPrompt);
    nextPlan.localPrompts = nextPlan.segmentIds.map((id) => next.segments[id].prompt).join(" | ");
    nextPlan.negativePrompt = `${String(nextPlan.negativePrompt || "").replace(/(?:^|,\s*)duplicate sword(?=,|$)/i, "").trim()}, sword, blade, sword hilt, weapon, weapon-shaped light, sword reflection, duplicate weapon`.replace(/^,\s*/, "");
    nextPlan.status = "needs_render";
    nextPlan.inputHash = null;
    nextPlan.activeGeneratedVersion = null;
    nextPlan.generatedFile = null;
    nextPlan.generatedInputPath = null;
    nextPlan.lastError = null;
    delete nextPlan.activeRenderPromptId;
    delete nextPlan.renderQueuedAt;
    const timelineById = new Map((nextPlan.timelineData?.segments || []).map((segment) => [segment.id, segment]));
    nextPlan.timelineData = {
      ...(nextPlan.timelineData || {}),
      global_prompt: nextPlan.globalPrompt,
      segments: nextPlan.segmentIds.map((segmentId) => {
        const segment = next.segments[segmentId];
        const frame = next.frames[segment.frameId];
        return {
          ...(timelineById.get(segmentId) || {}),
          id: segment.id,
          start: segment.startFrame,
          length: segment.lengthFrames,
          prompt: segment.prompt,
          type: "image",
          imageFile: frame.expectedInputPath,
          fileName: frame.generatedFile,
          guideStrength: 1,
          isEndFrame: false,
          storyboardFrameId: frame.id
        };
      })
    };
    next.imports = { ...(next.imports || {}), [EDIT_ID]: receipt };
    next.updatedAt = now.toISOString();
    validateStoryboard(next, PROJECT_SLUG);
    assertNoPositiveSwordDirection(next);
    if (deepHash(nonTargetSnapshot(next)) !== beforeNonTargetHash) throw new Error("Swordless revision changed storyboard data outside C01");
    if (sha256File(storyboardFile) !== startingSha256) throw new Error("Storyboard changed during the swordless revision; no changes were committed");
    saveStoryboard(PROJECT_SLUG, next);
    storyboardSaved = true;
    const saved = loadStoryboard(PROJECT_SLUG);
    verifyState(saved, mediaDirectory, receipt);
    if (deepHash(nonTargetSnapshot(saved)) !== beforeNonTargetHash) throw new Error("Saved swordless revision changed non-C01 storyboard data");
    return { idempotent: false, storyboard: saved, receipt, backup: receipt.backup };
  } catch (error) {
    let restoreError = null;
    if (storyboardSaved) {
      const temporary = `${storyboardFile}.${process.pid}.${crypto.randomUUID()}.restore.tmp`;
      try {
        fs.copyFileSync(backup, temporary, fs.constants.COPYFILE_EXCL);
        fs.renameSync(temporary, storyboardFile);
      } catch (caught) {
        restoreError = caught;
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      }
    }
    if (!restoreError) {
      for (const file of createdFiles) {
        try { fs.unlinkSync(file); } catch {}
      }
    }
    if (restoreError) throw new Error(`Swordless update failed and automatic storyboard restore also failed; new media was preserved for recovery. Original error: ${error.message}. Restore error: ${restoreError.message}`);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = updateH01C01SwordlessDescent({ dryRun: process.argv.includes("--verify-only") });
  console.log(JSON.stringify({
    ok: true,
    dryRun: Boolean(result.dryRun),
    idempotent: result.idempotent,
    backup: result.backup,
    clipId: result.receipt.clipId,
    frames: result.receipt.frames.map(({ frameId, filename, version, width, height, bytes, sha256, activeReferenceCount }) => ({ frameId, filename, version, width, height, bytes, sha256, activeReferenceCount }))
  }, null, 2));
}
