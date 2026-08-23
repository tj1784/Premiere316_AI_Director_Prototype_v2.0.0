from pathlib import Path

# Fix active take lookup
p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\director-webapp\premiere-projects.mjs")
text = p.read_text(encoding="utf-8")
old = '''    const takes = normalizeSegmentTakes(planned);
    segment.generatedTakes = takes;
    segment.activeTakeId = planned.activeTakeId || activeTakeFromList(takes)?.id || null;
    segment.activeGeneratedVersion = planned.activeGeneratedVersion || activeTakeFromList(takes)?.v || null;
    const activeTake = activeTakeFromList(takes);
'''
new = '''    const takes = normalizeSegmentTakes(planned);
    const activeTake = activeTakeFromList(takes, planned.activeTakeId, planned.activeGeneratedVersion);
    segment.generatedTakes = takes;
    segment.activeTakeId = planned.activeTakeId || activeTake?.id || null;
    segment.activeGeneratedVersion = planned.activeGeneratedVersion || activeTake?.v || null;
'''
if old not in text:
    raise SystemExit("active take block not found")
text = text.replace(old, new, 1)

setter = '''
export function setClipGenerateOption(slug, clipId, optionId) {
  slug = assertProjectSlug(slug);
  const option = generateOptionForMode(null, optionId);
  if (!option || option.id !== optionId) throw new Error(`Unknown generate option: ${optionId}`);
  const storyboard = loadStoryboard(slug);
  const clip = storyboard.clips?.[clipId];
  if (!clip) throw new Error(`Storyboard clip not found: ${clipId}`);
  const plan = storyboard.videoPlans?.[clip.videoPlanId];
  if (!plan) throw new Error(`Storyboard video plan not found: ${clip.videoPlanId}`);
  clip.generateOptionId = option.id;
  plan.generateOptionId = option.id;
  if (option.generationMode) {
    clip.generationMode = option.generationMode;
    plan.generationMode = option.generationMode;
  }
  storyboard.defaults = { ...(storyboard.defaults || {}), generateOptionId: option.id };
  storyboard.updatedAt = new Date().toISOString();
  saveStoryboard(slug, storyboard);
  return { projectSlug: slug, clipId, generateOption: option };
}
'''
if "export function setClipGenerateOption" not in text:
    text = text.replace("export { PREMIERE_GENERATE_OPTIONS, HARROWING_AAA_I2V_GENERATE_OPTION, generateOptionForMode };", setter + "\nexport { PREMIERE_GENERATE_OPTIONS, HARROWING_AAA_I2V_GENERATE_OPTION, generateOptionForMode };", 1)
p.write_text(text, encoding="utf-8")
print("fixed takes + added setClipGenerateOption")

# Patch director server imports and routes
s = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\director-webapp\server.mjs")
st = s.read_text(encoding="utf-8")
old_imp = '''  workspaceForProjectClip,
  refreshBoundWorkspaceFromStoryboard
} from "./premiere-projects.mjs";
'''
new_imp = '''  workspaceForProjectClip,
  refreshBoundWorkspaceFromStoryboard,
  listSegmentTakes,
  activateSegmentTake,
  setClipGenerateOption
} from "./premiere-projects.mjs";
'''
if old_imp not in st:
    raise SystemExit("server import block not found")
if "listSegmentTakes" not in st:
    st = st.replace(old_imp, new_imp, 1)
    print("updated server imports")

old_route = '''app.get("/api/premiere/projects/:slug/scenes/:clipId/references", (req, res) => {
  try { res.json(sceneReferenceMedia(req.params.slug, req.params.clipId)); }
  catch (error) { res.status(404).json({ error: String(error.message || error) }); }
});
'''
new_route = '''app.get("/api/premiere/projects/:slug/scenes/:clipId/references", (req, res) => {
  try { res.json(sceneReferenceMedia(req.params.slug, req.params.clipId)); }
  catch (error) { res.status(404).json({ error: String(error.message || error) }); }
});

app.get("/api/premiere/projects/:slug/scenes/:clipId/segments/:segmentId/takes", (req, res) => {
  try { res.json(listSegmentTakes(req.params.slug, req.params.clipId, req.params.segmentId)); }
  catch (error) { res.status(404).json({ error: String(error.message || error) }); }
});

app.post("/api/premiere/projects/:slug/scenes/:clipId/segments/:segmentId/takes/activate", (req, res) => {
  try {
    const takeId = String(req.body?.takeId || req.body?.id || "");
    if (!takeId) return res.status(400).json({ error: "takeId required" });
    const result = activateSegmentTake(req.params.slug, req.params.clipId, req.params.segmentId, takeId);
    if (workspace?.premiere?.projectSlug === req.params.slug && workspace?.premiere?.clipId === req.params.clipId) {
      const segment = (workspace.timeline?.segments || []).find((item) => String(item.id) === String(req.params.segmentId));
      if (segment) {
        segment.generatedTakes = result.takes;
        segment.activeTakeId = result.activeTakeId;
        segment.activeGeneratedVersion = result.activeGeneratedVersion;
        segment.activeTakeFile = result.activeTake?.previewFile || result.activeTake?.file || null;
      }
      atomicWrite(STATE_FILE, workspace);
    }
    res.json({ ok: true, ...result, workspace: workspaceForClient(workspace) });
  } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});

app.post("/api/premiere/projects/:slug/generate-option", (req, res) => {
  try {
    const clipId = String(req.body?.clipId || workspace?.premiere?.clipId || "");
    const optionId = String(req.body?.optionId || req.body?.generateOptionId || "");
    if (!clipId || !optionId) return res.status(400).json({ error: "clipId and optionId required" });
    const result = setClipGenerateOption(req.params.slug, clipId, optionId);
    if (workspace?.premiere?.projectSlug === req.params.slug) {
      workspace = workspaceForProjectClip(workspace, req.params.slug, clipId);
      atomicWrite(STATE_FILE, workspace);
    }
    res.json({ ok: true, ...result, workspace: workspaceForClient(workspace), overview: projectOverview(req.params.slug) });
  } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});
'''
if old_route not in st:
    raise SystemExit("references route not found")
if "segments/:segmentId/takes" not in st:
    st = st.replace(old_route, new_route, 1)
    print("added take and generate-option routes")

s.write_text(st, encoding="utf-8")
print("wrote server.mjs")
