from pathlib import Path

p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\director-webapp\server.mjs")
t = p.read_text(encoding="utf-8")

old_apply = """function applyHarrowingPromptOnly(apiPrompt, text, imageFile) {
  const prompt = structuredClone(apiPrompt);
  if (prompt[\"376\"]?.inputs) prompt[\"376\"].inputs.value = text;
  if (prompt[\"380\"]?.inputs) prompt[\"380\"].inputs.prompt = text;
  if (imageFile && prompt[\"395\"]?.inputs) prompt[\"395\"].inputs.image = imageFile;
  return prompt;
}"""

new_apply = """function isComfyInputName(name) {
  const value = String(name || \"\").trim();
  return Boolean(value) && !/[\\\\/]/.test(value) && /\\.(png|jpe?g|webp)$/i.test(value);
}

function writeHarrowingPromptToHell(text) {
  if (!fs.existsSync(HARROWING_HELL_WORKFLOW)) throw new Error(\"HARROWING OF HELL.json not found\");
  const graph = JSON.parse(fs.readFileSync(HARROWING_HELL_WORKFLOW, \"utf8\"));
  const visit = (nodes) => {
    for (const node of nodes || []) {
      const id = Number(node.id);
      if (!Array.isArray(node.widgets_values) || !node.widgets_values.length) continue;
      if (id === 376 || id === 380 || id === 398) node.widgets_values[0] = text;
    }
  };
  visit(graph.nodes);
  for (const sub of graph.definitions?.subgraphs || []) visit(sub.nodes);
  fs.writeFileSync(HARROWING_HELL_WORKFLOW, `${JSON.stringify(graph, null, 2)}\\n`);
  return HARROWING_HELL_WORKFLOW;
}

function applyHarrowingPromptOnly(apiPrompt, text, imageFile) {
  const prompt = structuredClone(apiPrompt);
  if (prompt[\"376\"]?.inputs) prompt[\"376\"].inputs.value = text;
  if (prompt[\"380\"]?.inputs) prompt[\"380\"].inputs.prompt = text;
  if (isComfyInputName(imageFile) && prompt[\"395\"]?.inputs) prompt[\"395\"].inputs.image = imageFile;
  return prompt;
}"""

if old_apply not in t:
    raise SystemExit("applyHarrowingPromptOnly block not found")
t = t.replace(old_apply, new_apply, 1)

old_404 = """app.use(\"/api\", (_req, res) => res.status(404).json({ error: \"Director API route not found\" }));

app.get(\"*\", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, \"index.html\")));"""

new_routes = """app.get(\"/api/workflow\", async (req, res) => {
  try {
    const { preparedWorkspace, job, built } = await compileSelectedSegment(req.query.segmentId);
    const name = segmentWorkflowName(preparedWorkspace, job);
    const extraWorkflow = isHarrowingGenerate(preparedWorkspace)
      ? JSON.parse(fs.readFileSync(HARROWING_HELL_WORKFLOW, \"utf8\"))
      : sourceGraph;
    const body = JSON.stringify({ prompt: built.prompt, extra_pnginfo: { workflow: extraWorkflow } }, null, 2);
    res.setHeader(\"content-type\", \"application/json\");
    res.setHeader(\"content-disposition\", \"attachment; filename=\\\"\" + name + \"\\\"\");
    res.send(body);
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.post(\"/api/push-to-comfyui\", async (req, res) => {
  try {
    if (isHarrowingGenerate(workspace)) {
      const selectedSegmentId = String(req.body?.segmentId || workspace.selectedSegmentId || \"\").trim();
      const preparedWorkspace = await prepareProjectMedia(workspace, {
        mode: \"selected\",
        segmentId: selectedSegmentId
      });
      const jobs = buildSegmentJobs(preparedWorkspace, selectedSegmentId);
      const job = jobs[0] || null;
      const text = harrowingPromptText(preparedWorkspace, job);
      if (!text) throw new Error(\"No Premiere prompt to push onto HARROWING OF HELL.json\");
      const workflowFile = writeHarrowingPromptToHell(text);
      return res.json({
        ok: true,
        segmentId: job?.sourceSegmentId || selectedSegmentId || null,
        workflowName: \"HARROWING OF HELL.json\",
        workflowFile,
        promptChars: text.length
      });
    }
    const { preparedWorkspace, job, built } = await compileSelectedSegment(req.body?.segmentId);
    const name = segmentWorkflowName(preparedWorkspace, job);
    fs.mkdirSync(SEGMENT_WORKFLOW_DIR, { recursive: true });
    const workflowFile = path.join(SEGMENT_WORKFLOW_DIR, name);
    const payload = { prompt: built.prompt, extra_pnginfo: { workflow: sourceGraph } };
    fs.writeFileSync(workflowFile, JSON.stringify(payload, null, 2));
    res.json({
      ok: true,
      segmentId: job.sourceSegmentId,
      workflowName: name,
      workflowFile,
      workflowLibraryFolder: SEGMENT_WORKFLOW_DIR
    });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.use(\"/api\", (_req, res) => res.status(404).json({ error: \"Director API route not found\" }));

app.get(\"*\", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, \"index.html\")));"""

if old_404 not in t:
    raise SystemExit("404 block not found")
t = t.replace(old_404, new_routes, 1)

old_late = """app.get(\"/api/workflow\", async (req, res) => {
  try {
    const { preparedWorkspace, job, built } = await compileSelectedSegment(req.query.segmentId);
    const name = segmentWorkflowName(preparedWorkspace, job);
    const body = JSON.stringify({ prompt: built.prompt, extra_pnginfo: { workflow: sourceGraph } }, null, 2);
    res.setHeader(\"content-type\", \"application/json\");
    res.setHeader(\"content-disposition\", \"attachment; filename=\\\"\" + name + \"\\\"\");
    res.send(body);
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.post(\"/api/push-to-comfyui\", async (req, res) => {
  try {
    const { preparedWorkspace, job, built } = await compileSelectedSegment(req.body?.segmentId);
    const name = segmentWorkflowName(preparedWorkspace, job);
    fs.mkdirSync(SEGMENT_WORKFLOW_DIR, { recursive: true });
    const workflowFile = path.join(SEGMENT_WORKFLOW_DIR, name);
    const payload = { prompt: built.prompt, extra_pnginfo: { workflow: sourceGraph } };
    fs.writeFileSync(workflowFile, JSON.stringify(payload, null, 2));
    res.json({
      ok: true,
      segmentId: job.sourceSegmentId,
      workflowName: name,
      workflowFile,
      workflowLibraryFolder: SEGMENT_WORKFLOW_DIR
    });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});
"""

if old_late not in t:
    raise SystemExit("late routes not found for removal")
t = t.replace(old_late, "", 1)

p.write_text(t, encoding="utf-8")
print("patched", p)
print("push_count", t.count('app.post("/api/push-to-comfyui"'))
print("workflow_count", t.count('app.get("/api/workflow"'))
print("has_write", "writeHarrowingPromptToHell" in t)
print("has_comfy_name", "isComfyInputName" in t)
print("late_after_404", t.find('app.use("/api"') < t.find('const server = app.listen'))
