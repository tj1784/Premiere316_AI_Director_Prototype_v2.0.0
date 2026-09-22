import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, ImagePlus, Play, Plus, RefreshCw, Trash2, Type } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";
import { getDirectorRuntime } from "@/lib/studio/director-runtime-api";
import type { DirectorRuntimeStatus } from "@/lib/studio/director-runtime";
import { buildDirectorPlanEditor, createDirectorScene, directorPlanForScene, directorPlanImages, extractDirectorPlanFromEditor, listDirectorImageOptions, saveDirectorPlan, scopeDirectorPlanEditor } from "@/lib/studio/director-scene-authoring";
import type { DirectorScenePlan, DirectorSceneSegment } from "@/lib/studio/director-scene-authoring";
import { readDirectorSceneSelection, rememberDirectorSceneSelection, resolveDirectorSceneSelection } from "@/lib/studio/director-scene-selection";
import type { DirectorReviewResult, DirectorJobStatusResult } from "@/lib/studio/director-execution";
import { desktopDirectorJobStatus, desktopReviewDirectorWorkflow, desktopRunDirectorWorkflow, isDesktopApp } from "@/lib/desktop/client";
import { decodeDirectorDraft, encodeDirectorDraft, normalizeDirectorEditorJson, rebindDirectorEditorImages, restoreDirectorEditorImages } from "@/lib/studio/director-workflow-editor";
import { readyTextFile, saveReadyFile } from "@/lib/utils";
import { ContinuationSource } from "./continuation-source";

const fieldClass = "min-h-11 w-full min-w-0 rounded-md border border-border bg-inset px-3 py-2 text-fg";
type Editor = { key: string; source: unknown; baseline: string; json: string; edited: boolean };
type ReviewedWorkflow = Extract<DirectorReviewResult, { ok: true }> & { segmentId: string; label: string };
type Review = { fingerprint: string; workflows: ReviewedWorkflow[] };
type RenderJob = { promptId: string; label: string; submittedAt: number; uncertain?: boolean };

export function DirectorVideoPanel({ picture }: { picture: Picture }) {
  const selectedShotId = useStudio((state) => state.selectedShotId);
  const generateFilterId = useStudio((state) => state.generateFilterId);
  const replaceActive = useStudio((state) => state.replaceActive);
  const [selection, setSelection] = useState(() => readDirectorSceneSelection(picture.id));
  const scenes = picture.scenes.map((scene) => ({ sceneId: scene.id, title: scene.slugline || scene.emotionalBeat || scene.id }));
  const selectedScene = resolveDirectorSceneSelection(picture.id, scenes, picture.shots, [generateFilterId, selectedShotId], selection?.pictureId === picture.id ? selection : readDirectorSceneSelection(picture.id));
  const [newTitle, setNewTitle] = useState("");
  const existingTitle = picture.scenes.find((scene) => scene.id === selectedScene.sceneId)?.slugline ?? "";
  const [sceneTitle, setSceneTitle] = useState(existingTitle);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState<DirectorRuntimeStatus | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    setSelection(selectedScene);
    if (selectedScene.sceneId) rememberDirectorSceneSelection(selectedScene);
  }, [selectedScene.pictureId, selectedScene.sceneId, selectedScene.focusId]);
  useEffect(() => { setSceneTitle(existingTitle); }, [selectedScene.sceneId, existingTitle]);
  const renameScene = () => {
    const title = sceneTitle.trim();
    if (!title) { setSceneTitle(existingTitle); setError("A scene title cannot be empty."); return; }
    if (title === existingTitle) return;
    const current = useStudio.getState().pictures.find((item) => item.id === picture.id);
    if (current) replaceActive({ ...current, updatedAt: Date.now(), scenes: current.scenes.map((scene) => scene.id === selectedScene.sceneId ? { ...scene, slugline: title } : scene) });
    setError("");
  };
  const addScene = () => {
    try {
      const current = useStudio.getState().pictures.find((item) => item.id === picture.id);
      if (!current) return;
      const sceneId = `director-scene-${crypto.randomUUID()}`;
      replaceActive(createDirectorScene(current, { sceneId, title: newTitle }));
      setSelection({ ...selectedScene, sceneId }); setNewTitle(""); setError("");
    } catch (cause) { setError(message(cause, "The scene could not be added.")); }
  };
  const check = async () => {
    setChecking(true);
    try { setRuntime(await getDirectorRuntime()); }
    catch { setError("Could not check the LTX Director generation service."); }
    finally { setChecking(false); }
  };
  return <section className="grid min-w-0 gap-4 rounded-lg border border-border bg-elevated p-4 text-fg" aria-label="LTX Director video workflow">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-display text-xl">Video generation · LTX Director</h3><p className="mt-2 text-sm leading-relaxed text-muted">Build scenes from your images and prompts. Review the workflow here, then approve video generation.</p></div><Button variant="secondary" disabled={checking || busy} onClick={() => void check()}><RefreshCw aria-hidden="true" />{checking ? "Checking service…" : "Check generation service"}</Button></div>
    {runtime ? <p className="text-sm leading-relaxed text-muted" role="status">{runtime.message}</p> : null}
    {!isDesktopApp() ? <p className="rounded-md bg-inset p-3 text-sm text-muted">Scene editing, workflow review and export are available here. Video generation uses the Premiere316 desktop app.</p> : null}
    <div className="grid min-w-0 items-end gap-3 lg:grid-cols-2">
      <label className="grid min-w-0 gap-2 text-sm">Scene<select className={fieldClass} aria-label="LTX Director scene" value={selectedScene.sceneId} disabled={busy || !scenes.length} onChange={(event) => setSelection({ ...selectedScene, sceneId: event.target.value })}>{!scenes.length ? <option value="">No scenes yet</option> : scenes.map((scene, index) => <option key={scene.sceneId} value={scene.sceneId}>{index + 1}. {scene.title}</option>)}</select></label>
      <form className="flex min-w-0 items-end gap-2" onSubmit={(event) => { event.preventDefault(); addScene(); }}><label className="grid min-w-0 flex-1 gap-2 text-sm">New scene title<input className={fieldClass} aria-label="New Director scene title" placeholder="Give your scene a title" value={newTitle} maxLength={500} disabled={busy} onChange={(event) => setNewTitle(event.target.value)} /></label><Button type="submit" variant="secondary" disabled={busy || !newTitle.trim()}><Plus aria-hidden="true" />Add scene</Button></form>
    </div>
    {selectedScene.sceneId ? <label className="grid min-w-0 gap-2 text-sm">Scene title<input aria-label="Director scene title" className={fieldClass} value={sceneTitle} disabled={busy} maxLength={500} onChange={(event) => setSceneTitle(event.target.value)} onBlur={renameScene} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label> : null}
    {error ? <p className="text-sm text-rec" role="alert">{error}</p> : null}
    {selectedScene.sceneId ? <DirectorSceneEditor key={`${picture.id}:${selectedScene.sceneId}`} picture={picture} sceneId={selectedScene.sceneId} focusedShotId={selectedScene.focusId} onBusy={setBusy} /> : <p className="rounded-md bg-inset p-4 text-sm text-muted">Add your first scene, then add an image or text segment to start directing.</p>}
  </section>;
}

function DirectorSceneEditor({ picture, sceneId, focusedShotId, onBusy }: { picture: Picture; sceneId: string; focusedShotId: string | null; onBusy: (busy: boolean) => void }) {
  const replaceActive = useStudio((state) => state.replaceActive);
  const plan = useMemo(() => directorPlanForScene(picture, sceneId), [picture, sceneId]);
  const resolvedImages = directorPlanImages(picture, plan);
  const planKey = JSON.stringify(plan);
  const sceneKey = `${picture.id}:${sceneId}:${planKey}:${resolvedImages.key}`;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [operation, setOperation] = useState<"review" | "export" | "run" | "image" | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [hasReviewed, setHasReviewed] = useState(false);
  const [browserReview, setBrowserReview] = useState("");
  const [runNotice, setRunNotice] = useState("");
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [selectedSegmentId, setSelectedSegmentId] = useState(() => plan.segments.find((segment) => segment.shotId === focusedShotId)?.segmentId ?? plan.segments[0]?.segmentId ?? "");
  const [statuses, setStatuses] = useState<Record<string, DirectorJobStatusResult>>({});
  const busyRef = useRef(false);
  const currentKey = useRef(sceneKey);
  currentKey.current = sceneKey;
  const desktop = isDesktopApp();
  const readyEditor = editor?.key === sceneKey ? editor : null;
  const imageOptions = listDirectorImageOptions(picture);
  const visiblePlan = useMemo(() => {
    if (!readyEditor) return plan;
    try { return extractDirectorPlanFromEditor(plan, normalizeDirectorEditorJson(readyEditor.json, readyEditor.baseline)); }
    catch { return null; }
  }, [readyEditor?.json, readyEditor?.baseline, planKey]);
  const segments = visiblePlan?.segments ?? plan.segments;
  const selectedSegment = segments.find((segment) => segment.segmentId === selectedSegmentId) ?? segments[0];
  const targetSegments = scope === "all" ? segments : selectedSegment ? [selectedSegment] : [];
  const fingerprint = `${sceneKey}:${picture.scenes.find((scene) => scene.id === sceneId)?.slugline ?? ""}:${scope}:${targetSegments.map((segment) => segment.segmentId).join(",")}:${readyEditor?.json ?? ""}`;
  const currentFingerprint = useRef(fingerprint);
  currentFingerprint.current = fingerprint;
  const canRun = desktop && !!review && review.fingerprint === fingerprint && review.workflows.length > 0 && review.workflows.every((item) => item.issues.length === 0) && !operation;
  const savedJobs = picture.directorRenderJobs?.[sceneId];
  const jobs: RenderJob[] = savedJobs?.jobs?.length ? savedJobs.jobs : savedJobs ? [{ ...savedJobs, label: "Scene generation" }] : [];
  const jobsKey = jobs.map((job) => job.promptId).join(",");
  const getCurrentPicture = () => useStudio.getState().pictures.find((item) => item.id === picture.id);
  const invalidate = () => { setReview(null); setBrowserReview(""); setError(""); };
  const writeDraft = (current: Picture, draft: Editor, sourceRevision: string) => {
    const normalized = normalizeDirectorEditorJson(draft.json, draft.baseline);
    const draftJson = encodeDirectorDraft(draft.baseline, normalized);
    const drafts = { ...current.directorWorkflowDrafts, [sceneId]: { sourceRevision, draftJson, updatedAt: Date.now() } };
    if (Object.values(drafts).reduce((sum, item) => sum + item.draftJson.length, 0) > 1_500_000) throw new Error("Workflow drafts reached this picture's save limit. Export this workflow to retain further edits.");
    return { ...current, directorWorkflowDrafts: drafts };
  };
  const persistDraft = () => {
    if (!readyEditor?.edited) return;
    try {
      const current = getCurrentPicture();
      if (current) replaceActive(writeDraft(current, readyEditor, plan.template.sha256));
      setDraftStatus("Scene and workflow changes saved in this picture.");
    } catch (cause) { setDraftStatus(message(cause, "Workflow draft could not be saved.")); }
  };
  const flushDraft = useRef(persistDraft);
  if (readyEditor) flushDraft.current = persistDraft;
  useEffect(() => () => { flushDraft.current(); }, []);
  useEffect(() => { if (review && review.fingerprint !== fingerprint) setReview(null); }, [fingerprint, review]);
  useEffect(() => { onBusy(!!operation); }, [operation, onBusy]);
  useEffect(() => {
    const focused = plan.segments.find((segment) => segment.shotId === focusedShotId);
    if (focused) setSelectedSegmentId(focused.segmentId);
  }, [focusedShotId]);
  useEffect(() => {
    if (editor?.key === sceneKey) return;
    let cancelled = false;
    const pendingDraft = editor?.edited ? editor : null;
    setEditor(null); invalidate(); setDraftStatus("");
    const load = async () => {
      try {
        const source = JSON.parse(new TextDecoder().decode(await readVerifiedFile(plan.template)));
        const baseline = buildDirectorPlanEditor(source, plan, { guides: resolvedImages.guides });
        const saved = getCurrentPicture()?.directorWorkflowDrafts?.[sceneId];
        const compatible = saved?.sourceRevision === plan.template.sha256;
        const restored = pendingDraft ? decodeDirectorDraft(baseline, encodeDirectorDraft(pendingDraft.baseline, normalizeDirectorEditorJson(pendingDraft.json, pendingDraft.baseline))) : compatible ? decodeDirectorDraft(baseline, saved.draftJson) : baseline;
        const json = rebindDirectorEditorImages(restored, baseline, resolvedImages.guides);
        if (!cancelled) { setEditor({ key: sceneKey, source, baseline, json, edited: !!pendingDraft }); setDraftStatus(compatible || pendingDraft ? "Saved scene and workflow loaded." : "Scene ready. Changes save in this picture."); }
      } catch (cause) { if (!cancelled) { if (pendingDraft) setEditor({ ...pendingDraft, key: sceneKey }); setError(message(cause, "The scene workflow could not be loaded.")); } }
    };
    void load();
    return () => { cancelled = true; };
  }, [sceneKey]);
  useEffect(() => {
    if (!readyEditor?.edited) return;
    const timeout = setTimeout(persistDraft, 650);
    return () => clearTimeout(timeout);
  }, [readyEditor?.json, readyEditor?.key]);
  useEffect(() => {
    if (!jobs.length || !desktop) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const done = new Set<string>();
    const poll = async () => {
      for (const job of jobs) {
        if (cancelled) return;
        if (done.has(job.promptId)) continue;
        try {
          const result = await desktopDirectorJobStatus(job.promptId);
          if (cancelled) return;
          setStatuses((current) => ({ ...current, [job.promptId]: result }));
          if (result.ok && ["completed", "failed", "cancelled"].includes(result.status)) done.add(job.promptId);
        } catch (cause) { if (!cancelled) setStatuses((current) => ({ ...current, [job.promptId]: { ok: false, error: message(cause, "Could not read generation status.") } })); }
      }
      if (!cancelled && done.size < jobs.length) timeout = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => { cancelled = true; if (timeout) clearTimeout(timeout); };
  }, [jobsKey, desktop]);

  const changePlan = (edit: (current: DirectorScenePlan) => DirectorScenePlan) => {
    if (!readyEditor || busyRef.current) return false;
    invalidate();
    try {
      const current = getCurrentPicture();
      if (!current) return false;
      const normalized = normalizeDirectorEditorJson(readyEditor.json, readyEditor.baseline);
      const nextPlan = edit(extractDirectorPlanFromEditor(plan, normalized));
      const nextPicture = saveDirectorPlan(current, nextPlan);
      const images = directorPlanImages(nextPicture, nextPlan);
      const baseline = buildDirectorPlanEditor(readyEditor.source, nextPlan, { guides: images.guides });
      const json = buildDirectorPlanEditor(JSON.parse(normalized), nextPlan, { guides: images.guides });
      const nextEditor = { ...readyEditor, key: `${picture.id}:${sceneId}:${JSON.stringify(nextPlan)}:${images.key}`, baseline, json, edited: true };
      replaceActive(writeDraft(nextPicture, nextEditor, nextPlan.template.sha256));
      setEditor(nextEditor); invalidate(); setDraftStatus("Scene and workflow changes saved in this picture.");
      return true;
    } catch (cause) { setError(message(cause, "Fix the workflow JSON before changing scene controls.")); return false; }
  };
  const updateSegment = (segmentId: string, update: Partial<DirectorSceneSegment>) => changePlan((current) => ({ ...current, segments: current.segments.map((segment) => segment.segmentId === segmentId ? { ...segment, ...update } : segment) }));
  const addSegment = (type: "image" | "text") => {
    const id = crypto.randomUUID(), segmentId = `segment-${id}`;
    changePlan((current) => ({ ...current, segments: [...current.segments, { segmentId, shotId: `director-shot-${id}`, type, durationFrames: current.frameRate * 5, prompt: "" }] }));
    setSelectedSegmentId(segmentId);
  };
  const moveSegment = (segmentId: string, offset: -1 | 1) => changePlan((current) => {
    const list = [...current.segments], from = list.findIndex((segment) => segment.segmentId === segmentId), to = from + offset;
    if (from < 0 || to < 0 || to >= list.length) return current;
    [list[from], list[to]] = [list[to], list[from]];
    return { ...current, segments: list };
  });
  const selectImage = async (segmentId: string, optionId: string) => {
    const option = imageOptions.find((item) => item.id === optionId);
    if (!option || busyRef.current || !readyEditor) return;
    busyRef.current = true; setOperation("image"); invalidate();
    const key = sceneKey;
    try {
      const { bytes, sha256 } = await readImageOption(option);
      await dataUrl(bytes);
      if (currentKey.current !== key) return;
      busyRef.current = false;
      updateSegment(segmentId, { imageBinding: { iterationId: option.iterationId, assetId: option.assetId, mediaUri: option.mediaUri, sha256, predecessorTakeId:option.predecessorTakeId, predecessorShotId:option.predecessorShotId, predecessorSha256:option.predecessorSha256 } });
    } catch (cause) { setError(message(cause, "The existing image could not be attached.")); }
    finally { busyRef.current = false; setOperation(null); }
  };
  const changeJson = (json: string) => {
    if (!readyEditor) return;
    setEditor({ ...readyEditor, json, edited: true }); invalidate(); setDraftStatus("Saving workflow changes…");
  };
  const preparedWorkflows = async (allScene = false) => {
    if (!readyEditor || !visiblePlan) throw new Error("Fix the workflow JSON before review or export.");
    const targets = allScene ? segments : targetSegments;
    if (!targets.length) throw new Error("Add a segment before reviewing this scene.");
    if (!allScene && targets.length > 64) throw new Error("Review up to 64 segments at a time. Select one segment or split the scene.");
    const activePlan = { ...visiblePlan, segments: targets };
    const images = directorPlanImages(picture, activePlan);
    if (images.issues.length) throw new Error(images.issues.join(" "));
    const imageData: Record<string, string> = {};
    for (const guide of Object.values(images.guides)) if (!imageData[guide.sha256]) imageData[guide.sha256] = await dataUrl(await readVerifiedFile(guide));
    const normalized = rebindDirectorEditorImages(readyEditor.json, readyEditor.baseline, images.guides);
    const scoped = allScene ? [{ segmentId: "scene", label: "Complete scene", json: normalized }] : targets.map((segment) => ({ segmentId: segment.segmentId, label: `Segment ${segments.findIndex((item) => item.segmentId === segment.segmentId) + 1} · ${formatSeconds(segment.durationFrames / visiblePlan.frameRate)}s`, json: scopeDirectorPlanEditor(normalized, segment.segmentId) }));
    return scoped.map((item) => ({ ...item, json: restoreDirectorEditorImages(item.json, item.json, imageData) }));
  };
  const reviewWorkflow = async () => {
    if (busyRef.current || !readyEditor) return;
    busyRef.current = true; setOperation("review"); invalidate(); setRunNotice("");
    const reviewedFingerprint = fingerprint;
    try {
      const workflows = await preparedWorkflows();
      const results: ReviewedWorkflow[] = [];
      for (const workflow of workflows) {
        if (currentFingerprint.current !== reviewedFingerprint) return;
        if (desktop) {
          const result = await desktopReviewDirectorWorkflow({ pictureId: picture.id, sceneId, renderSlot: workflow.segmentId, workflowJson: workflow.json });
          if (!result.ok) throw new Error(`${workflow.label}: ${result.error}`);
          results.push({ ...result, segmentId: workflow.segmentId, label: workflow.label });
        }
      }
      if (currentFingerprint.current !== reviewedFingerprint) return;
      if (desktop) setReview({ fingerprint: reviewedFingerprint, workflows: results });
      else setBrowserReview(`${workflows.length} workflow${workflows.length === 1 ? "" : "s"} and existing image files verified. Native node validation and generation are available in the desktop app.`);
      setHasReviewed(true); persistDraft();
    } catch (cause) { if (currentFingerprint.current === reviewedFingerprint) setError(message(cause, "Workflow review failed.")); }
    finally { busyRef.current = false; setOperation(null); }
  };
  const rememberJob = (promptId: string, label: string, uncertain = false) => {
    const current = getCurrentPicture();
    if (!current) return;
    const old = current.directorRenderJobs?.[sceneId];
    const previous: RenderJob[] = old?.jobs ?? (old ? [{ ...old, label: "Previous generation" }] : []);
    const job = { promptId, label, submittedAt: Date.now(), ...(uncertain ? { uncertain: true } : {}) };
    const next = [...previous.filter((item) => item.promptId !== promptId), job];
    replaceActive({ ...current, directorRenderJobs: { ...current.directorRenderJobs, [sceneId]: { ...job, jobs: next } } });
  };
  const runWorkflow = async () => {
    if (!canRun || !review || busyRef.current) return;
    busyRef.current = true; setOperation("run"); setError(""); setReview(null); setRunNotice("");
    let accepted = 0;
    const warnings: string[] = [];
    try {
      for (const workflow of review.workflows) {
        const result = await desktopRunDirectorWorkflow(workflow.reviewId);
        if (!result.ok) {
          if (result.promptId) rememberJob(result.promptId, workflow.label, !!result.uncertain);
          throw new Error(`${workflow.label}: ${result.error}${result.uncertain ? " This submission is uncertain; check its status before trying again." : ""}`);
        }
        rememberJob(result.promptId, workflow.label); accepted++;
        if (result.warning) warnings.push(result.warning);
        setRunNotice(`${accepted} of ${review.workflows.length} workflows submitted to LTX Director.`);
      }
      setRunNotice(`${accepted} workflow${accepted === 1 ? "" : "s"} submitted to LTX Director. Generation status appears below.${warnings.length ? ` ${warnings.join(" ")}` : ""}`);
    } catch (cause) {
      setError(message(cause, "The reviewed workflow could not be started."));
      setRunNotice(`${accepted} of ${review.workflows.length} workflows confirmed submitted. Remaining submissions stopped; already submitted jobs remain listed below.`);
    } finally { busyRef.current = false; setOperation(null); }
  };
  const exportScene = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setOperation("export"); setError("");
    try {
      const [workflow] = await preparedWorkflows(true);
      const file = readyTextFile(`${sceneId}-LTX-Director-with-images.json`, workflow.json, "application/json");
      try { if (await saveReadyFile(file) !== "cancelled") toast.success("Scene exported with its current workflow and existing images."); }
      finally { setTimeout(() => URL.revokeObjectURL(file.href), 60_000); }
    } catch (cause) { setError(message(cause, "Scene export failed.")); }
    finally { busyRef.current = false; setOperation(null); }
  };

  return <div className="grid min-w-0 gap-4">
    {!readyEditor && !error ? <p className="text-sm text-muted" role="status">Loading scene workflow…</p> : null}
    {readyEditor ? <>
      <fieldset className="grid min-w-0 gap-3 rounded-md bg-inset p-3" disabled={!!operation || !visiblePlan}><legend className="px-1 text-sm font-medium">Generation settings</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {([ ["width", "Width", 0, 8192], ["height", "Height", 0, 8192], ["frameRate", "FPS", 1, 240], ["baseSteps", "Base steps", 1, 10000], ["refineSteps", "Refine steps", 1, 10000] ] as const).map(([key, label, min, max]) => <NumberControl key={key} label={`Director ${label}`} displayLabel={label} value={(visiblePlan ?? plan)[key]} min={min} max={max} step={1} onDirty={invalidate} onCommit={(value) => changePlan((current) => ({ ...current, [key]: value, ...(key === "frameRate" ? { segments: current.segments.map((segment) => ({ ...segment, durationFrames: Math.max(Math.ceil(value * 0.1), Math.round(segment.durationFrames / current.frameRate * value)) })) } : {}) }))} />)}
        </div><p className="text-xs leading-relaxed text-muted">{segments.length} timeline segments · {formatSeconds(segments.reduce((sum, segment) => sum + segment.durationFrames, 0) / (visiblePlan ?? plan).frameRate)} seconds total. Each segment generates as a separate video.{(visiblePlan ?? plan).width === 0 && (visiblePlan ?? plan).height === 0 ? " Output resolution follows the supplied reference images." : ""}</p>
      </fieldset>
      <label className="grid min-w-0 gap-2 text-sm">Global scene prompt<textarea aria-label="Director global scene prompt" className={`${fieldClass} min-h-24`} disabled={!!operation || !visiblePlan} value={(visiblePlan ?? plan).globalPrompt} onChange={(event) => changePlan((current) => ({ ...current, globalPrompt: event.target.value }))} /></label>
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-display text-lg">Timeline segments</h4><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={!!operation || !visiblePlan} onClick={() => addSegment("image")}><ImagePlus aria-hidden="true" />Add image segment</Button><Button variant="secondary" disabled={!!operation || !visiblePlan} onClick={() => addSegment("text")}><Type aria-hidden="true" />Add text segment</Button></div></div>
      {!segments.length ? <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted">Add an image segment to animate an existing asset, or a text segment to generate from a prompt.</p> : <div className="grid min-w-0 gap-3">{segments.map((segment, index) => {
        const guide = resolvedImages.guides[segment.segmentId];
        const option = imageOptions.find((item) => guide?.iterationId ? item.iterationId === guide.iterationId : item.mediaUri === guide?.mediaUri);
        const start = segments.slice(0, index).reduce((sum, item) => sum + item.durationFrames, 0) / (visiblePlan ?? plan).frameRate;
        return <article key={segment.segmentId} className={`grid min-w-0 gap-3 rounded-md border p-3 ${selectedSegment?.segmentId === segment.segmentId ? "border-accent bg-inset" : "border-border"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"><input type="radio" name={`director-segment-${sceneId}`} checked={selectedSegment?.segmentId === segment.segmentId} disabled={!!operation} onChange={() => { setSelectedSegmentId(segment.segmentId); invalidate(); }} />Segment {index + 1} <span className="font-normal text-muted">{segment.type === "image" ? "Image" : "Text"} · starts {formatSeconds(start)}s</span></label><div className="flex gap-1"><Button size="sm" variant="ghost" aria-label={`Move segment ${index + 1} up`} disabled={!!operation || !visiblePlan || index === 0} onClick={() => moveSegment(segment.segmentId, -1)}><ArrowUp aria-hidden="true" /></Button><Button size="sm" variant="ghost" aria-label={`Move segment ${index + 1} down`} disabled={!!operation || !visiblePlan || index === segments.length - 1} onClick={() => moveSegment(segment.segmentId, 1)}><ArrowDown aria-hidden="true" /></Button><Button size="sm" variant="ghost" aria-label={`Remove segment ${index + 1}`} disabled={!!operation || !visiblePlan} onClick={() => changePlan((current) => ({ ...current, segments: current.segments.filter((item) => item.segmentId !== segment.segmentId) }))}><Trash2 aria-hidden="true" /></Button></div></div>
          <div className={`grid min-w-0 gap-3 ${segment.type === "image" ? "md:grid-cols-4" : "md:grid-cols-4"}`}>
            <div className="grid min-w-0 content-start gap-3">
              {segment.type === "image" && <ContinuationSource picture={picture} disabled={!!operation || !visiblePlan} onBind={imageBinding => updateSegment(segment.segmentId, {imageBinding})} />}
              <label className="grid gap-2 text-xs">Editorial shot<select aria-label={`Segment ${index + 1} editorial shot`} className={fieldClass} disabled={!!operation || !visiblePlan} value={segment.shotId} onChange={event => updateSegment(segment.segmentId, {shotId:event.target.value})}>{[...new Set([...picture.shots.filter(shot => shot.sceneId === sceneId).map(shot => shot.id), ...segments.map(item => item.shotId)])].map(id => <option key={id} value={id}>{id}</option>)}</select><span className="text-muted">Multiple clips may belong to one editorial shot. Each retains its own prompt and input review; this does not certify seamless continuation.</span></label>
              {segment.type === "image" ? <><div className="grid aspect-video place-items-center overflow-hidden rounded-md bg-elevated">{guide ? <img className="h-full w-full object-contain" src={guide.mediaUri} alt={`Existing starting image for segment ${index + 1}`} loading="lazy" /> : <span className="px-3 text-center text-xs text-muted">Choose an existing image</span>}</div><label className="grid min-w-0 gap-2 text-xs">Starting image<select aria-label={`Segment ${index + 1} existing image`} className={fieldClass} value={option?.id ?? ""} disabled={!!operation || !visiblePlan} onChange={(event) => void selectImage(segment.segmentId, event.target.value)}><option value="" disabled>{guide ? guide.label : "Select from picture assets"}</option>{imageOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><p className="text-xs text-muted">{guide?.label ?? (imageOptions.length ? "Uses the image already in your picture." : "Add an image to your picture assets first.")}</p></> : null}
              <NumberControl label={`Segment ${index + 1} duration seconds`} displayLabel="Duration (seconds)" value={segment.durationFrames / (visiblePlan ?? plan).frameRate} min={Math.ceil((visiblePlan ?? plan).frameRate * 0.1) / (visiblePlan ?? plan).frameRate} max={Math.min(600, 10000 / (visiblePlan ?? plan).frameRate)} step={0.01} disabled={!!operation || !visiblePlan} onDirty={invalidate} onCommit={(value) => updateSegment(segment.segmentId, { durationFrames: Math.max(Math.ceil((visiblePlan ?? plan).frameRate * 0.1), Math.round(value * (visiblePlan ?? plan).frameRate)) })} />
            </div>
            <label className="grid min-w-0 gap-2 text-sm md:col-span-3">Video prompt<textarea aria-label={`Segment ${index + 1} Director video prompt`} className={`${fieldClass} min-h-36`} value={segment.prompt} disabled={!!operation || !visiblePlan} onChange={(event) => updateSegment(segment.segmentId, { prompt: event.target.value })} /></label>
          </div>
        </article>;
      })}</div>}
      <details className="min-w-0 rounded-md bg-inset p-3"><summary className="cursor-pointer text-sm font-medium">Modify full workflow JSON</summary><p className="my-3 text-sm leading-relaxed text-muted">Edit node settings here. Images use stable references and are restored from your existing assets before review or export. Selecting a segment keeps your custom node settings.</p><textarea aria-label="LTX Director workflow JSON" spellCheck={false} className="h-96 w-full min-w-0 rounded-md border border-border bg-elevated p-3 font-mono text-xs leading-relaxed text-fg" value={readyEditor.json} disabled={!!operation} onChange={(event) => changeJson(event.target.value)} />{!visiblePlan ? <p className="mt-3 text-sm text-rec">Correct the workflow JSON to use scene controls or review it.</p> : null}</details>
      <p className="text-xs text-muted" role="status">{draftStatus}</p>
      <div className="grid gap-3 rounded-md border border-border p-3"><label className="grid gap-2 text-sm">Generate<select aria-label="Director generation scope" className={fieldClass} value={scope} disabled={!!operation} onChange={(event) => { setScope(event.target.value as "selected" | "all"); invalidate(); }}><option value="selected">Selected segment only</option><option value="all">All segments as separate videos</option></select></label><p className="text-sm text-muted">{scope === "all" ? `${targetSegments.length} separate workflows will be reviewed before approval.` : selectedSegment ? `Segment ${segments.indexOf(selectedSegment) + 1} · ${formatSeconds(selectedSegment.durationFrames / (visiblePlan ?? plan).frameRate)} seconds` : "Select or add a segment to generate."} · {(visiblePlan ?? plan).width} × {(visiblePlan ?? plan).height} · {(visiblePlan ?? plan).frameRate} fps</p>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={!readyEditor || !visiblePlan || !!operation || !targetSegments.length} onClick={() => void reviewWorkflow()}><RefreshCw aria-hidden="true" />{operation === "review" ? "Validating workflows…" : hasReviewed ? "Validate changes" : "Review workflow"}</Button><Button disabled={!canRun} onClick={() => void runWorkflow()}><Play aria-hidden="true" />{operation === "run" ? "Submitting generation…" : scope === "all" ? "Approve & generate videos" : "Approve & generate video"}</Button><Button variant="outline" disabled={!visiblePlan || !!operation || !segments.length} onClick={() => void exportScene()}><Download aria-hidden="true" />{operation === "export" ? "Preparing export…" : "Export scene with images"}</Button></div>
        <p className="text-xs leading-relaxed text-muted">Approval sends only the reviewed workflows and reuses your existing images. Editing any scene setting, image, prompt or segment requires a new review.</p>
      </div>
    </> : null}
    {error ? <p className="rounded-md border border-border bg-inset p-3 text-sm text-rec" role="alert">{error}</p> : null}
    {review ? <div className="grid gap-3 rounded-md bg-inset p-3 text-sm" aria-label="Workflow review result"><p className="font-medium">{review.workflows.length} workflow{review.workflows.length === 1 ? "" : "s"} reviewed · {review.workflows.some((item) => item.issues.length) ? "Resolve the issues below" : "Ready for your approval"}</p>{review.workflows.map((item) => <div className="grid gap-2 border-t border-border pt-3" key={item.reviewId}><p>{item.label} · {item.nodeCount} compiled nodes</p><p className="break-all font-mono text-xs text-muted">SHA-256 {item.workflowSha256}</p>{item.issues.length ? <ul className="list-inside list-disc text-rec">{item.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : null}{!item.runtimeAvailable ? <p className="text-muted">Approval will start the generation service and check its models and nodes before submission.</p> : null}</div>)}</div> : null}
    {browserReview ? <p className="rounded-md bg-inset p-3 text-sm text-muted" role="status">{browserReview}</p> : null}
    {runNotice ? <p className="text-sm text-muted" role="status">{runNotice}</p> : null}
    {jobs.length ? <div className="grid gap-3" aria-label="Director render status"><h4 className="font-display text-lg">Video generations</h4>{[...jobs].reverse().map((job) => <DirectorJob key={job.promptId} job={job} result={statuses[job.promptId]} />)}</div> : null}
  </div>;
}

function DirectorJob({ job, result }: { job: RenderJob; result?: DirectorJobStatusResult }) {
  const progress = result?.ok ? result.progress : undefined;
  const fraction = progress?.value !== null && progress?.value !== undefined && progress.max && progress.max > 0 ? Math.max(0, Math.min(1, progress.value / progress.max)) : null;
  const liveProgress = progress?.connection === "connected";
  return <div className="grid min-w-0 gap-2 rounded-md bg-inset p-3 text-sm">
    <p>{job.label} · {result?.ok ? ({ queued: "Waiting to generate", running: "Generating video", completed: "Video ready", failed: "Generation failed", cancelled: "Generation cancelled", unknown: "Checking generation status" }[result.status]) : "Video generation"}</p>
    <p className="break-all font-mono text-xs text-muted">Prompt ID: {job.promptId}</p>
    <p role="status">{result ? result.ok ? result.message : result.error : "Checking submitted job…"}</p>
    {job.uncertain ? <p className="text-xs text-muted">Submission acknowledgement was uncertain. Check this job before submitting again.</p> : null}
    {result?.ok && result.elapsedSeconds !== undefined ? <p className="text-xs text-muted">Elapsed: {Math.floor(result.elapsedSeconds / 60)}m {Math.floor(result.elapsedSeconds % 60)}s</p> : null}
    {progress && result?.ok && result.status === "running" ? <div className="grid gap-2">
      <p className="text-xs text-muted">{!liveProgress ? "Last reported: " : ""}{progress.stage || progress.nodeType || "Generation step"}{fraction !== null ? ` · ${progress.value} / ${progress.max} steps` : ""}</p>
      {fraction !== null && liveProgress ? <progress aria-label="Current node progress" className="h-2 w-full accent-accent" max={1} value={fraction} /> : null}
      <p className="text-xs text-muted">{liveProgress ? "Progress describes the current node, not the whole video." : `Live progress is reconnecting${progress.lastUpdated ? `; last update ${new Date(progress.lastUpdated).toLocaleTimeString()}` : ""}. Job status checks continue.`}</p>
    </div> : null}
    {result?.ok && result.outputs.length ? <ul className="grid gap-2">{result.outputs.map((output) => <li key={output.url}><a className="break-all underline" href={output.url} target="_blank" rel="noreferrer">{output.filename}</a></li>)}</ul> : null}
  </div>;
}

function NumberControl({ label, displayLabel, value, min, max, step, disabled, onDirty, onCommit }: { label: string; displayLabel: string; value: number; min: number; max: number; step: number; disabled?: boolean; onDirty: () => void; onCommit: (value: number) => boolean | void }) {
  const [text, setText] = useState(String(Number(value.toFixed(3))));
  useEffect(() => { setText(String(Number(value.toFixed(3)))); }, [value]);
  const commit = () => { const number = Number(text); if (!text.trim() || !Number.isFinite(number) || number < min || number > max || step === 1 && !Number.isInteger(number)) { setText(String(Number(value.toFixed(3)))); return; } if (number !== value && onCommit(number) === false) setText(String(Number(value.toFixed(3)))); };
  return <label className="grid min-w-0 gap-2 text-xs">{displayLabel}<input aria-label={label} type="number" className={fieldClass} min={min} max={max} step={step} value={text} disabled={disabled} onChange={(event) => { onDirty(); setText(event.target.value); }} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}
function message(cause: unknown, fallback: string) { return cause instanceof Error ? cause.message : fallback; }
function formatSeconds(value: number) { return Number(value.toFixed(2)).toString(); }
async function fileHash(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function readVerifiedFile(file: { mediaUri: string; sha256: string; bytes?: number }): Promise<ArrayBuffer> {
  const response = await fetch(file.mediaUri);
  if (!response.ok) throw new Error("A source workflow or starting image could not be read.");
  const bytes = await response.arrayBuffer();
  if ((file.bytes !== undefined && bytes.byteLength !== file.bytes) || await fileHash(bytes) !== file.sha256.toLowerCase()) throw new Error("An attached image or workflow changed or is incomplete. Select a verified existing image.");
  return bytes;
}
async function readImageOption(file: { mediaUri: string; sha256?: string; bytes?: number }) {
  const response = await fetch(file.mediaUri);
  if (!response.ok) throw new Error("The existing image could not be read.");
  const bytes = await response.arrayBuffer(), sha256 = await fileHash(bytes);
  if (file.sha256 && file.sha256.toLowerCase() !== sha256 || file.bytes !== undefined && file.bytes !== bytes.byteLength) throw new Error("The selected image changed. Refresh its asset before selecting it.");
  return { bytes, sha256 };
}
function dataUrl(bytes: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
    const type = header[0] === 137 && header[1] === 80 ? "image/png" : header[0] === 255 && header[1] === 216 ? "image/jpeg" : header[0] === 82 && header[1] === 73 && header[8] === 87 && header[9] === 69 ? "image/webp" : null;
    if (!type) { reject(new Error("Select an existing PNG, JPEG or WebP image.")); return; }
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Starting image conversion failed."));
    reader.onerror = () => reject(new Error("Starting image conversion failed."));
    reader.readAsDataURL(new Blob([bytes], { type }));
  });
}
