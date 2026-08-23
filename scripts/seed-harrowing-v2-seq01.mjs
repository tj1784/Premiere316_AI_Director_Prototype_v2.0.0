import { loadProject, saveProject } from "../server/projects.js";
import { createDirectorAsset, updateAssetManifestCounts, saveAssetPackageFiles } from "../server/assets.js";
import { createDeterministicShotPlan } from "../server/screenplay.js";
import { seedStoryboardFromShotPlan } from "../server/storyboard.js";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { projectDir } from "../server/paths.js";

const SLUG = "harrowing_of_hell_v2";

const JOHN_PROMPT = `JOHN - BELOVED DISCIPLE — APPEARANCE: FOUR-VIEW IDENTITY, ANATOMY, COSTUME, AND CONTINUITY REFERENCE.

STYLE-ONLY IMAGE REFERENCE LOCK — Premiere316
Use the ComfyUI image references only for art direction: sacred cinematic realism, warm divine-gold light, dark smoky umber shadows, ember haze, live-action camera language, realistic material physics, detailed texture, and restrained film grain. Do not copy content, identity, wardrobe, wounds, props, locations, crowds, gates, or layout from the references unless this exact row prompt requests them.

Create a four-view cinematic character ingredients sheet showing the same person in frontal three-quarter portrait, full-body, side profile, and rear-head/costume view. Lock facial identity, age, ethnicity, hairline, complete crown and rear hair, costume construction, body proportions, hands, scars, wounds, and carried props across every panel. One face exists only on the front of the head. Photorealistic live-action production reference, physically coherent lighting, exact anatomy, clean hands, consistent scale and materials, no captions, no logos, no watermarks, no borders, and no written or graphical elements.

Young adult Mediterranean Jewish man, early twenties, about 5'7". Intelligent grief, not pretty-boy glamour. Olive-tan skin, visible pores, no cosmetics. Dark brown eyes wet at the rims, set under a calm brow. Short dark hair with complete crown and rear-head coverage, a thin youthful beard that does not hide the jaw. Simple first-century dusty earth-tone tunic and mantle. Bare or sandaled feet dusted with Golgotha limestone. He steps beneath Mary as her knees weaken and holds her without looking away from the cross.

Frontal three-quarter: head and shoulders, gaze slightly up and left toward the cross, mouth closed, jaw set. Full-body: he supports Mary at his right side, weight forward, mantle drape locked. Side profile: locked nose-to-chin silhouette, short hair over the ear and nape. Rear-head: complete hair crown, no face on the back of the skull, mantle construction across the shoulders. Exact human anatomy, five fingers, consistent scale.`;

function upsertAsset(project, input) {
  const existing = project.assets.items.find((item) => item.id === input.idHint || (item.name === input.name && item.variant === input.variant));
  if (existing) {
    if (input.prompt && !existing.promptEnhancedAt) existing.prompt = input.prompt;
    if (input.sampleText && !existing.sampleText) existing.sampleText = input.sampleText;
    return existing;
  }
  const asset = createDirectorAsset(input, project.assets.items);
  project.assets.items.push(asset);
  return asset;
}

const project = loadProject(SLUG);
project.screenplay = project.screenplay || {};
project.screenplay.settings = {
  ...(project.screenplay.settings || {}),
  runtimeMinutes: 30,
  declaredTitle: "JESUS: THE VIOLENT DESCENT",
  concept: project.screenplay.settings?.concept || "Harrowing of Hell V2: a cinematic story with a complete screenplay and production asset package."
};

const john = project.assets.items.find((item) => item.id === "character-john-beloved-disciple-appearance");
if (john) {
  john.prompt = JOHN_PROMPT;
  john.sourcePrompt = JOHN_PROMPT;
  john.promptEnhancedAt = new Date().toISOString();
  john.reviewState = "explicit-prompt";
}

upsertAsset(project, {
  category: "voice",
  name: "JOHN",
  variant: "voice-design",
  prompt: "Young adult male tenor-baritone, Levantine Jewish, early twenties, clear English with restrained grief. Intimate, not pretty, not theatrical.",
  sampleText: "Woman, behold thy mother. I will not leave her."
});
upsertAsset(project, {
  category: "character",
  name: "THE UNREPENTANT THIEF",
  variant: "appearance",
  prompt: "Four-view identity lock for the unrepentant thief on the far Golgotha cross. Lean Levantine man, mid-thirties, sneering exhaustion, no crown of thorns, crucifixion wounds in wrists and feet only. Distinct from the repentant thief. Photoreal biblical epic, no captions."
});
upsertAsset(project, {
  category: "character",
  name: "THE WINE-SPONGE SOLDIER",
  variant: "appearance",
  prompt: "Four-view identity lock for the Roman auxiliary who lifts the sour-wine sponge on hyssop at Golgotha. Adult male, sun-leathered, practical helmet and dusty lorica, not the centurion. Photoreal biblical epic, no captions."
});
upsertAsset(project, {
  category: "guide-frame",
  name: "LAST FRAME GOLGOTHA SPIRIT DEPARTURE",
  variant: "production-reference",
  prompt: "Last-frame still of SEQ-01: Jesus' mortal body hangs still on the center cross while a gold-white living spirit form, barefoot in white linen of light, steps toward the vertical wound in the earth. Mary cannot see Him. Photoreal biblical epic, no captions."
});

updateAssetManifestCounts(project.assets);
if (project.assets.review?.status) {
  project.assets.review.status.render_ready_shot_manifest = true;
  project.assets.review.status.summary = "SEQ-01 Golgotha now has a deterministic shot plan and storyboard seed. Remaining chapters still require render-ready clips.";
}

const plan = createDeterministicShotPlan(project.screenplay.markdown, {
  targetShotSeconds: 12,
  maxShots: 24,
  sceneFilter: "Golgotha|Temple|veil|BACK TO GOLGOTHA"
});
plan.model = "deterministic-fallback";
plan.fallback = true;
plan.warning = "SEQ-01 deterministic plan seeded without the pinned screenplay model.";
project.screenplay.shotPlan = plan;
project.updatedAt = new Date().toISOString();
saveAssetPackageFiles(project);
saveProject(project);

const seeded = seedStoryboardFromShotPlan(SLUG, plan, {
  title: project.name,
  fps: project.settings?.fps || 24,
  aspectRatio: "2.39:1",
  chapterId: "H01",
  sceneId: "H01-S01",
  chapterTitle: "Golgotha",
  sceneTitle: "EXT. GOLGOTHA — death, veil, spirit departure"
});

const enhanceDir = path.join(projectDir(SLUG), "production", "prompt-enhancement");
mkdirSync(enhanceDir, { recursive: true });
writeFileSync(path.join(enhanceDir, "last-run.json"), JSON.stringify({
  id: "enhance_mt47z7tl",
  projectSlug: SLUG,
  status: "interrupted",
  stage: "Interrupted",
  message: "Previous enhance run was interrupted at 11/158. Retry selected SEQ-01 assets.",
  total: 158,
  completed: 11,
  failed: 2,
  active: false,
  finishedAt: new Date().toISOString()
}, null, 2));

console.log(JSON.stringify({
  ok: true,
  assets: project.assets.total,
  shotPlan: plan.shots.length,
  shotSeconds: plan.totalDurationSec,
  storyboardClips: seeded.summary.clips,
  seededClips: seeded.seeded
}, null, 2));
