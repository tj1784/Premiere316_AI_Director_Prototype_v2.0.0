from pathlib import Path
p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\client\src\components\LtxDirectorWorkspace.tsx")
text = p.read_text(encoding="utf-8")

helpers = '''
function takePreviewUrl(projectSlug: string, take: any) {
  const file = take?.previewFile || take?.file || take?.generatedInputPath || "";
  return file ? `/api/integrations/ltx/director/premiere/media/${encodeURIComponent(projectSlug)}?file=${encodeURIComponent(file)}` : "";
}

function segmentTakes(segment: any) {
  return Array.isArray(segment?.generatedTakes) ? segment.generatedTakes.filter(Boolean) : [];
}

function activeTakeOf(segment: any) {
  const takes = segmentTakes(segment);
  return takes.find((take: any) => String(take.id) === String(segment?.activeTakeId))
    || takes.find((take: any) => Number(take.v) === Number(segment?.activeGeneratedVersion))
    || null;
}

function previewPlaylist(workspace: any, projectSlug: string) {
  return (workspace?.timeline?.segments || [])
    .filter((segment: any) => [undefined, "image", "video"].includes(segment?.type) && (Number(segment.length) || 0) > 0)
    .slice()
    .sort((left: any, right: any) => (Number(left.start) || 0) - (Number(right.start) || 0))
    .map((segment: any) => {
      const take = activeTakeOf(segment);
      return {
        segmentId: segment.id,
        fileName: segment.fileName || segment.id,
        start: Number(segment.start) || 0,
        length: Math.max(1, Number(segment.length) || 1),
        take,
        url: take ? takePreviewUrl(projectSlug, take) : ""
      };
    });
}

'''
if "function previewPlaylist" not in text:
    text = text.replace("function roleLabel(value: string) {", helpers + "function roleLabel(value: string) {", 1)
    print("added helpers")

old_state = '''  const [sceneChoice, setSceneChoice] = useState(productionClipId || "");
  const [editRevision, setEditRevision] = useState(0);
'''
new_state = '''  const [sceneChoice, setSceneChoice] = useState(productionClipId || "");
  const [editRevision, setEditRevision] = useState(0);
  const [referenceTab, setReferenceTab] = useState<"inputs" | "library">("inputs");
  const [timelinePreview, setTimelinePreview] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
'''
if old_state not in text:
    raise SystemExit("state block missing")
if "referenceTab" not in text:
    text = text.replace(old_state, new_state, 1)
    print("added ui state")

old_queue_mode = '''  const generationMode = String(workspace?.premiere?.generationMode || "");
  const timelineQueueMode = generationMode === "t2v_with_semantic_references" || workspace?.settings?.queueMode === "timeline";
  const queueMode: "timeline" | "segments" = timelineQueueMode ? "timeline" : "segments";
'''
new_queue_mode = '''  const generationMode = String(workspace?.premiere?.generationMode || "");
  const generateOptions = workspace?.premiere?.generateOptions || [];
  const selectedGenerateOption = workspace?.premiere?.generateOption || generateOptions[0] || null;
  const generateOptionId = String(workspace?.premiere?.generateOptionId || selectedGenerateOption?.id || "");
  const timelineQueueMode = selectedGenerateOption?.queueMode === "timeline"
    || generationMode === "t2v_with_semantic_references"
    || workspace?.settings?.queueMode === "timeline";
  const queueMode: "timeline" | "segments" = timelineQueueMode ? "timeline" : "segments";
  const playlist = useMemo(() => previewPlaylist(workspace, project.slug), [workspace, project.slug]);
  const selectedTakes = segmentTakes(selected);
  const selectedActiveTake = activeTakeOf(selected);
'''
if old_queue_mode not in text:
    raise SystemExit("queue mode block missing")
if "generateOptionId" not in text:
    text = text.replace(old_queue_mode, new_queue_mode, 1)
    print("added generate option + playlist")

old_queue_fn = '''  const queue = async (mode: "selected" | "segments" | "timeline") => {
    if (!workspace || busy || queueBusy || !serviceReady || !semanticQueueReady || (mode === "selected" && !selectedEligible)) return;
    setBusy("queue");
    try {
      await saveWorkspace(true);
      const result = await integrationApi("/director/queue", {
        method: "POST",
        body: JSON.stringify(mode === "selected" ? { mode, segmentId: selected?.id } : { mode })
      });
      const target = mode === "selected" ? "selected segment" : mode === "timeline" ? "semantic timeline" : "segment set";
      setNotice(`Accepted ${result.accepted?.length || 0} ${target} request${Number(result.accepted?.length || 0) === 1 ? "" : "s"} after the shared-GPU idle check. Premiere316 will report the authoritative provider queue state.`);
      await refreshHealth();
    } catch (error: any) { setNotice(String(error.message || error)); }
    finally { setBusy(null); }
  };
'''
new_queue_fn = '''  const queue = async (mode: "selected" | "segments" | "timeline") => {
    if (!workspace || busy || queueBusy || !serviceReady || !semanticQueueReady || (mode === "selected" && !selectedEligible)) return;
    setBusy("queue");
    try {
      await saveWorkspace(true);
      const result = await integrationApi("/director/queue", {
        method: "POST",
        body: JSON.stringify(mode === "selected" ? { mode, segmentId: selected?.id } : { mode })
      });
      const accepted = Number(result.accepted?.length || 0);
      const target = mode === "selected"
        ? "I2V segment job"
        : mode === "timeline"
          ? "semantic timeline job"
          : `I2V segment job${accepted === 1 ? "" : "s"} (one prompt per segment)`;
      setNotice(`Queued ${accepted} ${target}. Queue All never submits the full clip as one long job.`);
      await refreshHealth();
    } catch (error: any) { setNotice(String(error.message || error)); }
    finally { setBusy(null); }
  };

  const chooseGenerateOption = async (optionId: string) => {
    if (!optionId || optionId === generateOptionId || busy) return;
    setBusy("option");
    try {
      const result = await integrationApi(`/director/premiere/projects/${encodeURIComponent(project.slug)}/generate-option`, {
        method: "POST",
        body: JSON.stringify({ clipId: workspace?.premiere?.clipId || sceneChoice, optionId })
      });
      if (result.workspace) setWorkspace(result.workspace);
      if (result.overview) setOverview(result.overview);
      setNotice(`Generate option: ${result.generateOption?.label || optionId}`);
    } catch (error: any) { setNotice(String(error.message || error)); }
    finally { setBusy(null); }
  };

  const activateTake = async (take: any) => {
    if (!selected?.id || !take || !workspace?.premiere?.clipId) return;
    const takeId = String(take.id || take.v);
    setWorkspace((current: any) => {
      if (!current) return current;
      const next = structuredClone(current);
      const segment = (next.timeline?.segments || []).find((item: any) => String(item.id) === String(selected.id));
      if (segment) {
        segment.activeTakeId = take.id || `take-v${take.v}`;
        segment.activeGeneratedVersion = take.v;
        segment.activeTakeFile = take.previewFile || take.file || null;
      }
      return next;
    });
    try {
      const result = await integrationApi(
        `/director/premiere/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(workspace.premiere.clipId)}/segments/${encodeURIComponent(selected.id)}/takes/activate`,
        { method: "POST", body: JSON.stringify({ takeId }) }
      );
      if (result.workspace) setWorkspace(result.workspace);
      setNotice(`Active take: ${take.id || `v${take.v}`} on ${selected.id}`);
    } catch (error: any) { setNotice(String(error.message || error)); }
  };
'''
if old_queue_fn not in text:
    raise SystemExit("queue function missing")
if "activateTake" not in text:
    text = text.replace(old_queue_fn, new_queue_fn, 1)
    print("updated queue + added activate/option")

p.write_text(text, encoding="utf-8")
print("partial ui patch ok", len(text.splitlines()))
