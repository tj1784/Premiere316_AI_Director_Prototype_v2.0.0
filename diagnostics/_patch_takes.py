from pathlib import Path

p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\director-webapp\premiere-projects.mjs")
text = p.read_text(encoding="utf-8")

# 1) Import generate option helpers
old_imp = '''import {
  canonicalSemanticReferenceRole,
  LTX25_PREMIERE316_PROFILE
} from "./premiere-api-delegation.mjs";
'''
new_imp = '''import {
  canonicalSemanticReferenceRole,
  generateOptionForMode,
  HARROWING_AAA_I2V_GENERATE_OPTION,
  LTX25_PREMIERE316_PROFILE,
  PREMIERE_GENERATE_OPTIONS
} from "./premiere-api-delegation.mjs";
'''
if old_imp not in text:
    raise SystemExit("import block not found")
if "generateOptionForMode" not in text:
    text = text.replace(old_imp, new_imp, 1)
    print("updated imports")

# 2) Attach takes when building storyboard workspace segments
old_seg = '''    if (generated) {
      segment.projectMediaPath = generated.relative;
      segment.projectMediaBytes = generated.bytes;
      segment.projectMediaSha256 = generated.sha256;
      segment.fileName = path.basename(generated.relative);
      segment.imageFile = current.imageFile || frame.expectedInputPath || null;
      segment.guideStrength = Number(current.guideStrength ?? plan.guideStrength ?? 1);
    } else {
      delete segment.imageFile;
      delete segment.imageB64;
    }
    return segment;'''
new_seg = '''    if (generated) {
      segment.projectMediaPath = generated.relative;
      segment.projectMediaBytes = generated.bytes;
      segment.projectMediaSha256 = generated.sha256;
      segment.fileName = path.basename(generated.relative);
      segment.imageFile = current.imageFile || frame.expectedInputPath || null;
      segment.guideStrength = Number(current.guideStrength ?? plan.guideStrength ?? 1);
    } else {
      delete segment.imageFile;
      delete segment.imageB64;
    }
    const takes = normalizeSegmentTakes(planned);
    segment.generatedTakes = takes;
    segment.activeTakeId = planned.activeTakeId || activeTakeFromList(takes)?.id || null;
    segment.activeGeneratedVersion = planned.activeGeneratedVersion || activeTakeFromList(takes)?.v || null;
    const activeTake = activeTakeFromList(takes);
    if (activeTake?.file) {
      segment.activeTakeFile = takeMediaPath(activeTake.file);
    }
    return segment;'''
if old_seg not in text:
    raise SystemExit("segment attach block not found")
if "generatedTakes = takes" not in text:
    text = text.replace(old_seg, new_seg, 1)
    print("attached takes to workspace segments")

# 3) Attach generate option on premiere binding
old_bind = '''    generationMode,
    ...(generationMode === LTX25_PREMIERE316_PROFILE.generationMode ? {'''
new_bind = '''    generationMode,
    generateOptionId: generateOptionForMode(generationMode, plan.generateOptionId || clip.generateOptionId || storyboard.defaults?.generateOptionId).id,
    generateOption: generateOptionForMode(generationMode, plan.generateOptionId || clip.generateOptionId || storyboard.defaults?.generateOptionId),
    generateOptions: PREMIERE_GENERATE_OPTIONS,
    ...(generationMode === LTX25_PREMIERE316_PROFILE.generationMode ? {'''
if old_bind not in text:
    raise SystemExit("premiere binding block not found")
if "generateOptionId" not in text:
    text = text.replace(old_bind, new_bind, 1)
    print("attached generate option to premiere binding")

# 4) Record segment takes inside markDirectorRender
old_mark = '''    if (update.status === "done") {
      plan.activeGeneratedVersion = committedVersion.v;
      plan.generatedFile = path.basename(committedVersion.file);
      plan.generatedInputPath = committedVersion.file;
      plan.status = "rendered";
    }'''
new_mark = '''    if (update.status === "done") {
      plan.activeGeneratedVersion = committedVersion.v;
      plan.generatedFile = path.basename(committedVersion.file);
      plan.generatedInputPath = committedVersion.file;
      plan.status = "rendered";
    }
    recordSegmentTake(storyboard, committedVersion, update.status);'''
if old_mark not in text:
    raise SystemExit("markDirectorRender version block not found")
if "recordSegmentTake(storyboard, committedVersion" not in text:
    text = text.replace(old_mark, new_mark, 1)
    print("hooked recordSegmentTake")

helpers = '''
function takeMediaPath(file) {
  const relative = safeRelative(file);
  return relative.startsWith("media/") ? relative : `media/clips/${path.basename(relative)}`;
}

function normalizeSegmentTakes(segment) {
  const versions = Array.isArray(segment?.generatedVersions) ? segment.generatedVersions.filter(Boolean) : [];
  return versions.map((version, index) => {
    const number = Number(version.v) || index + 1;
    return {
      ...version,
      id: version.id || `take-v${number}`,
      v: number,
      file: version.file || version.generatedInputPath || version.outputFile || null,
      previewFile: takeMediaPath(version.file || version.generatedInputPath || version.outputFile || "")
    };
  });
}

function activeTakeFromList(takes, activeTakeId = null, activeVersion = null) {
  if (!takes.length) return null;
  return takes.find((take) => String(take.id) === String(activeTakeId))
    || takes.find((take) => Number(take.v) === Number(activeVersion))
    || takes[takes.length - 1];
}

function recordSegmentTake(storyboard, version, status) {
  const segmentId = String(version?.segmentId || "");
  const segment = storyboard?.segments?.[segmentId];
  if (!segment || !version) return null;
  segment.generatedVersions = Array.isArray(segment.generatedVersions) ? segment.generatedVersions : [];
  const promptKey = String(version.comfyPromptId || version.promptId || "");
  const duplicate = segment.generatedVersions.find((item) => String(item.comfyPromptId || item.promptId || "") === promptKey && promptKey);
  const nextV = duplicate
    ? Number(duplicate.v)
    : Math.max(0, ...segment.generatedVersions.map((item) => Number(item.v) || 0)) + 1;
  const take = {
    ...version,
    id: duplicate?.id || `take-v${nextV}`,
    v: nextV,
    file: takeMediaPath(version.file || version.generatedInputPath || version.outputFile || "")
  };
  if (!duplicate) segment.generatedVersions.push(take);
  else Object.assign(duplicate, take);
  if (["done", "partial"].includes(String(status || ""))) {
    segment.activeGeneratedVersion = take.v;
    segment.activeTakeId = take.id;
  }
  return take;
}

export function listSegmentTakes(slug, clipId, segmentId) {
  slug = assertProjectSlug(slug);
  const storyboard = loadStoryboard(slug);
  if (!storyboard.clips?.[clipId]) throw new Error(`Storyboard clip not found: ${clipId}`);
  const segment = storyboard.segments?.[segmentId];
  if (!segment) throw new Error(`Storyboard segment not found: ${segmentId}`);
  const takes = normalizeSegmentTakes(segment);
  const active = activeTakeFromList(takes, segment.activeTakeId, segment.activeGeneratedVersion);
  return {
    projectSlug: slug,
    clipId,
    segmentId,
    takes,
    activeTakeId: active?.id || null,
    activeGeneratedVersion: active?.v || null
  };
}

export function activateSegmentTake(slug, clipId, segmentId, takeId) {
  slug = assertProjectSlug(slug);
  const storyboard = loadStoryboard(slug);
  if (!storyboard.clips?.[clipId]) throw new Error(`Storyboard clip not found: ${clipId}`);
  const segment = storyboard.segments?.[segmentId];
  if (!segment) throw new Error(`Storyboard segment not found: ${segmentId}`);
  const takes = normalizeSegmentTakes(segment);
  const take = takes.find((item) => String(item.id) === String(takeId) || String(item.v) === String(takeId));
  if (!take) throw new Error(`Take not found: ${takeId}`);
  segment.activeTakeId = take.id;
  segment.activeGeneratedVersion = take.v;
  storyboard.updatedAt = new Date().toISOString();
  saveStoryboard(slug, storyboard);
  return {
    projectSlug: slug,
    clipId,
    segmentId,
    takes: normalizeSegmentTakes(segment),
    activeTakeId: take.id,
    activeGeneratedVersion: take.v,
    activeTake: take
  };
}

export { PREMIERE_GENERATE_OPTIONS, HARROWING_AAA_I2V_GENERATE_OPTION, generateOptionForMode };
'''

if "export function activateSegmentTake" not in text:
    text = text.rstrip() + "\n" + helpers
    print("appended take helpers")

p.write_text(text + ("\n" if not text.endswith("\n") else ""), encoding="utf-8")
print("wrote premiere-projects.mjs", len(text))
