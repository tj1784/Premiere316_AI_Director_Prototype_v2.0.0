import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compileDirectorWorkflow } from "./director-compiler.mjs";

export const DIRECTOR_ENDPOINT = "http://127.0.0.1:8190";
const MAX_WORKFLOW_BYTES = 256 * 1024 * 1024;
const MAX_PROMPT_BYTES = 100 * 1024 * 1024;
const IMAGE_SUBFOLDER = "premiere316/director";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Only an immutable, previously reviewed workflow can reach the render API. */
export function createDirectorExecutionService({
  directory, ensureHost, openWorkflow, getProgress, fetchImpl = fetch,
  compile = compileDirectorWorkflow, now = Date.now, uuid = randomUUID, journalImpl,
  endpoint = DIRECTOR_ENDPOINT, prepareWorkflow,
}) {
  const reviews = new Map();
  const jobs = new Map();
  const inFlight = new Map();
  const fetchLocal = (path, options = {}) => fetchImpl(`${endpoint}${path}`, { signal: AbortSignal.timeout(30_000), redirect: "error", ...options });
  async function checkResponse(response) {
    if (response.ok) return response;
    let value;
    let body = "";
    try { body = await response.text(); try { value = JSON.parse(body); } catch { /* HTTP errors may be plain text. */ } } catch { /* Preserve the known status even if reading fails. */ }
    const error = new Error(errorMessage(value) || body.slice(0, 4000) || `LTX Director returned HTTP ${response.status}.`);
    error.httpStatus = response.status;
    throw error;
  }
  const request = async (path, options = {}) => {
    const response = await checkResponse(await fetchLocal(path, options));
    return response.json();
  };
  const journal = (record) => {
    if (journalImpl) return journalImpl(structuredClone(record));
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    const target = join(directory, `${record.promptId}.json`);
    writeFileSync(`${target}.tmp`, JSON.stringify(record), "utf8");
    renameSync(`${target}.tmp`, target);
  };
  const journalAfterAttempt = (record) => {
    try { journal(record); return undefined; }
    catch (error) { return `The render status is known in this session, but its local record could not be saved: ${error.message}`; }
  };
  function loadUnresolvedJobs() {
    if (!directory || !existsSync(directory)) return;
    for (const name of readdirSync(directory)) {
      const id = name.endsWith(".json") ? name.slice(0, -5) : "";
      if (!UUID.test(id) || jobs.has(id)) continue;
      const record = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (record?.promptId === id && ["submitting", "uncertain"].includes(record.state)) jobs.set(id, record);
    }
  }
  const lookupJob = (promptId) => {
    if (typeof promptId !== "string" || !UUID.test(promptId)) throw new Error("Invalid Director job ID.");
    if (!jobs.has(promptId) && directory) {
      const file = join(directory, `${promptId}.json`);
      if (existsSync(file)) jobs.set(promptId, JSON.parse(readFileSync(file, "utf8")));
    }
    const record = jobs.get(promptId);
    if (!record) throw new Error("This Director job does not belong to Premiere316.");
    return record;
  };
  async function operationalWorkflow(workflow, compiled) {
    if (prepareWorkflow) return prepareWorkflow(structuredClone(workflow), fetchLocal);
    const graph = structuredClone(workflow);
    const uploaded = new Map();
    async function verifiedInput(segment) {
      const image = embeddedImage(segment.imageB64);
      if (uploaded.has(image.sha256)) return uploaded.get(image.sha256);
      const expected = { name: `p316_${image.sha256}.${image.extension}`, subfolder: IMAGE_SUBFOLDER, type: "input" };
      const existing = await fetchLocal(imageViewPath(expected));
      let file = expected;
      if (existing.status === 404) {
        const form = new FormData();
        form.set("image", new Blob([image.bytes], { type: image.mime }), expected.name);
        form.set("type", "input");
        form.set("subfolder", IMAGE_SUBFOLDER);
        // ComfyUI may return a suffixed name after a concurrent upload. Never overwrite.
        file = safeImageReference(await request("/upload/image", { method: "POST", body: form }));
        const response = await checkResponse(await fetchLocal(imageViewPath(file)));
        verifyImageBytes(await response.arrayBuffer(), image.sha256);
      } else {
        await checkResponse(existing);
        verifyImageBytes(await existing.arrayBuffer(), image.sha256);
      }
      const result = { imageFile: `${file.subfolder ? `${file.subfolder}/` : ""}${file.name}`, imageB64: imageViewPath(file) };
      uploaded.set(image.sha256, result);
      return result;
    }
    for (const [id, apiNode] of Object.entries(compiled.prompt)) {
      if (apiNode.class_type !== "LTXDirector" || apiNode.inputs.timeline_data === undefined) continue;
      if (typeof apiNode.inputs.timeline_data !== "string") throw new Error("LTX Director needs an embedded timeline to verify its starting images.");
      const node = [graph, ...(graph.definitions?.subgraphs ?? [])].flatMap(container => container.nodes ?? [])
        .find(candidate => candidate.type === "LTXDirector" && String(candidate.id) === id);
      if (!node) throw new Error("The approved Director node could not be located.");
      const timeline = JSON.parse(apiNode.inputs.timeline_data);
      for (const segment of timeline.segments ?? []) {
        if (segment.type === "image" || segment.imageFile || segment.imageB64) Object.assign(segment, await verifiedInput(segment));
      }
      const serialized = JSON.stringify(timeline);
      if (Array.isArray(node.widgets_values)) node.widgets_values = node.widgets_values.map(value => value === apiNode.inputs.timeline_data ? serialized : value);
      else if (node.widgets_values && typeof node.widgets_values === "object") node.widgets_values.timeline_data = serialized;
      if (node.widgets_values_named) node.widgets_values_named.timeline_data = serialized;
      if (node.properties) node.properties.timeline_data = serialized;
    }
    return graph;
  }
  async function status(promptId) {
    try {
      const record = lookupJob(promptId);
      promptId = record.promptId;
      const elapsedSeconds = Math.max(0, Math.floor((now() - record.submittedAt) / 1000));
      const [history, live] = await Promise.all([
        request(`/history/${promptId}`),
        Promise.resolve().then(() => getProgress?.(promptId)).catch(() => null),
      ]);
      const item = history[promptId];
      if (item) {
        const failed = item.status?.status_str === "error";
        const cancelled = (item.status?.messages ?? []).some((message) => message?.[0] === "execution_interrupted");
        const executionError = (item.status?.messages ?? []).find((message) => message?.[0] === "execution_error")?.[1];
        const outputs = videoOutputs(item.outputs, endpoint);
        return { ok: true, promptId, status: cancelled ? "cancelled" : failed ? "failed" : item.status?.completed ? "completed" : "running",
          message: cancelled ? "Generation was cancelled before a video was saved." : failed ? String(executionError?.exception_message || "LTX Director reported a rendering error.").slice(0, 2000)
            : item.status?.completed ? `Render completed. ${outputs.length} video output(s) available.` : "Rendering in LTX Director…", outputs };
      }
      const queue = await request("/queue");
      const running = (queue.queue_running ?? []).some((entry) => entry[1] === promptId);
      const pending = (queue.queue_pending ?? []).some((entry) => entry[1] === promptId);
      const progress = live && { nodeId: live.nodeId, nodeType: live.nodeType, stage: live.stage, value: live.value, max: live.max, lastUpdated: live.lastUpdated, connection: live.connection };
      const step = Number.isFinite(live?.value) && Number.isFinite(live?.max) && live.max > 0 ? ` · ${live.value}/${live.max}` : "";
      const runningMessage = live?.stage ? `${live.connection === "connected" ? "" : "Last reported: "}${live.stage}${step}${live.connection === "connected" ? "" : " · Reconnecting to progress…"}` : "Generating video";
      return { ok: true, promptId, status: running ? "running" : pending ? "queued" : "unknown",
        message: running ? runningMessage : pending ? "Waiting for the active generation to finish." : live?.status === "cancelled" ? "Generation was cancelled." : "This job is not in the current queue or history. Check its status before submitting again.", outputs: [], ...(progress ? { progress } : {}), ...(running ? { elapsedSeconds } : {}), ...(!running && !pending && live?.status === "cancelled" ? { status: "cancelled" } : {}) };
    } catch (error) { return { ok: false, error: error.message }; }
  }
  function parseWorkflowInput(input) {
      if (!input || typeof input.pictureId !== "string" || !input.pictureId.length || input.pictureId.length > 200
        || typeof input.sceneId !== "string" || !input.sceneId.length || input.sceneId.length > 200
        || (input.renderSlot !== undefined && (typeof input.renderSlot !== "string" || !input.renderSlot.length || input.renderSlot.length > 200))
        || typeof input.workflowJson !== "string" || Buffer.byteLength(input.workflowJson) > MAX_WORKFLOW_BYTES) throw new Error("Invalid Director workflow review.");
      const workflow = JSON.parse(input.workflowJson);
      if (!workflow || !Array.isArray(workflow.nodes) || !workflow.nodes.length) throw new Error("Review a ComfyUI workflow containing nodes.");
      return workflow;
  }
  let opening = false;
  async function open(input) {
    if (opening) return { ok: false, error: "A scene is already opening in ComfyUI. Wait for it to finish." };
    opening = true;
    try {
      const workflow = parseWorkflowInput(input);
      const context = { pictureId: input.pictureId, sceneId: input.sceneId };
      await ensureHost();
      const objectInfo = await request("/object_info");
      const compiled = compile(workflow, objectInfo);
      // Model validation gates rendering, not opening an editor to fix the graph.
      const operational = await operationalWorkflow(workflow, compiled);
      if (!await openWorkflow(operational, context)) throw new Error("The selected scene could not be opened inside Premiere316.");
      return { ok: true, workflowOpened: true, sceneId: context.sceneId };
    } catch (error) { return { ok: false, error: error.message }; }
    finally { opening = false; }
  }
  async function review(input) {
    try {
      const workflow = parseWorkflowInput(input);
      let objectInfo = null;
      try { objectInfo = await request("/object_info", { signal: AbortSignal.timeout(5000) }); }
      catch { /* An offline host may be started only after approval. */ }
      const compiled = objectInfo ? compile(workflow, objectInfo) : null;
      const reviewId = uuid();
      const workflowSha256 = createHash("sha256").update(input.workflowJson).digest("hex");
      // Each segment has its own approval slot, so a reviewed scene batch can
      // contain multiple independent jobs without invalidating earlier segments.
      for (const [id, previous] of reviews) if (!previous.operation && previous.pictureId === input.pictureId && previous.sceneId === input.sceneId && previous.renderSlot === input.renderSlot) reviews.delete(id);
      if ([...reviews.values()].filter((entry) => !entry.operation).length >= 64) throw new Error("Up to 64 workflows can be reviewed at once. Generate the reviewed batch before reviewing more.");
      const result = { ok: true, reviewId, workflowSha256, nodeCount: compiled?.nodeCount ?? workflow.nodes.length,
        issues: compiled?.issues ?? [], runtimeAvailable: Boolean(objectInfo), endpoint };
      reviews.set(reviewId, { ...input, workflow, workflowSha256, result, reviewedAt: now(), operation: null });
      return result;
    } catch (error) { return { ok: false, error: error.message }; }
  }
  async function submit(reviewId, entry) {
    let record = null;
    let postAttempted = false;
    const workflowOpened = false;
    try {
      if (now() - entry.reviewedAt > 60 * 60 * 1000) throw new Error("This workflow review expired. Review it again before running.");
      if (entry.result.issues.length) throw new Error("Resolve the workflow validation issues and review it again.");
      loadUnresolvedJobs();
      const unresolved = [...jobs.values()].find(job => ["submitting", "uncertain"].includes(job.state)
        && job.pictureId === entry.pictureId && job.sceneId === entry.sceneId && job.workflowSha256 === entry.workflowSha256);
      if (unresolved) {
        const recovered = await status(unresolved.promptId);
        if (recovered.ok && recovered.status !== "unknown") {
          unresolved.state = recovered.status;
          const warning = journalAfterAttempt(unresolved);
          return { ok: true, reviewId, promptId: unresolved.promptId, workflowSha256: entry.workflowSha256, endpoint, workflowOpened: false, warning };
        }
        return { ok: false, uncertain: true, promptId: unresolved.promptId, error: `An earlier submission of this workflow is still unconfirmed. Check job ${unresolved.promptId} in LTX Director before submitting again.` };
      }
      await ensureHost();
      const objectInfo = await request("/object_info");
      const approved = compile(entry.workflow, objectInfo);
      if (approved.issues.length) throw new Error(`Workflow cannot run: ${approved.issues.join("; ")}`);
      const operational = await operationalWorkflow(entry.workflow, approved);
      const compiled = compile(operational, objectInfo);
      if (compiled.issues.length) throw new Error(`Workflow cannot run: ${compiled.issues.join("; ")}`);
      const promptId = uuid();
      record = { promptId, reviewId, pictureId: entry.pictureId, sceneId: entry.sceneId,
        ...(entry.renderSlot ? { renderSlot: entry.renderSlot } : {}),
        workflowSha256: entry.workflowSha256, submittedAt: now(), state: "submitting" };
      const body = JSON.stringify({ prompt_id: promptId, client_id: `premiere316-${reviewId}`, prompt: compiled.prompt,
        extra_data: { extra_pnginfo: { workflow: operational }, premiere316: record } });
      if (Buffer.byteLength(body) >= MAX_PROMPT_BYTES) throw new Error("The compiled workflow exceeds ComfyUI's 100 MiB request limit. Reduce embedded media or custom node data and review it again.");
      if (directory) {
        mkdirSync(directory, { recursive: true });
        // Preserve exactly what was reviewed, including its original embedded assets.
        writeFileSync(join(directory, `${promptId}.workflow.json`), entry.workflowJson, "utf8");
      }
      journal(record);
      jobs.set(promptId, record);
      // The approved graph goes directly to the runtime. Rendering never depends
      // on opening, loading or acknowledging a ComfyUI browser window.
      // A planned UUID permits recovery after an ambiguous network response.
      postAttempted = true;
      const response = await request("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (typeof response.prompt_id !== "string" || !UUID.test(response.prompt_id)) throw new Error("LTX Director did not acknowledge a valid job ID.");
      // A valid success response is authoritative even if a server changes the supplied ID.
      if (response.prompt_id !== promptId) {
        record.plannedPromptId = promptId;
        record.promptId = response.prompt_id;
        jobs.set(record.promptId, record);
        journalAfterAttempt({ ...record, promptId, actualPromptId: response.prompt_id, state: "redirected" });
      }
      record.state = "queued";
      const warning = journalAfterAttempt(record);
      return { ok: true, reviewId, promptId: record.promptId, workflowSha256: entry.workflowSha256, endpoint, workflowOpened, warning };
    } catch (error) {
      if (record && postAttempted) {
        if (error.httpStatus >= 400 && error.httpStatus < 500) {
          record.state = "rejected";
          record.error = error.message;
          const warning = journalAfterAttempt(record);
          return { ok: false, error: `LTX Director rejected the workflow: ${error.message}`, warning };
        }
        const recovered = await status(record.promptId);
        if (recovered.ok && recovered.status !== "unknown") {
          record.state = recovered.status;
          const warning = journalAfterAttempt(record);
          return { ok: true, reviewId, promptId: record.promptId, workflowSha256: entry.workflowSha256, endpoint, workflowOpened, warning };
        }
        record.state = "uncertain";
        record.error = error.message;
        const warning = journalAfterAttempt(record);
        return { ok: false, uncertain: true, promptId: record.promptId, error: `The submission could not be confirmed. Check job ${record.promptId} in LTX Director before submitting again. ${error.message}`, warning };
      }
      if (record) { record.state = "not-submitted"; record.error = error.message; journalAfterAttempt(record); }
      return { ok: false, error: error.message };
    }
  }
  async function run(reviewId) {
    const entry = typeof reviewId === "string" ? reviews.get(reviewId) : null;
    if (!entry) return { ok: false, error: "Review the current workflow before approving a render." };
    // Reserve before any await: a fresh review of the same immutable workflow
    // must share preparation/submission already in progress for that scene.
    if (!entry.operation) {
      const key = JSON.stringify([entry.pictureId, entry.sceneId, entry.workflowSha256]);
      if (!inFlight.has(key)) {
        const shared = Promise.resolve().then(() => submit(reviewId, entry)).finally(() => {
          if (inFlight.get(key) === shared) inFlight.delete(key);
        });
        inFlight.set(key, shared);
      }
      entry.operation = inFlight.get(key).finally(() => {
        entry.workflow = null;
        entry.workflowJson = "";
      });
    }
    return entry.operation;
  }
  return { open, review, run, status };
}

function embeddedImage(value) {
  const match = typeof value === "string" && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("Every Director starting image must use the exact embedded image reviewed in Premiere316.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.toString("base64") !== match[2]) throw new Error("A Director starting image has malformed base64 data.");
  const mime = match[1];
  const valid = mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid) throw new Error("A Director starting image does not match its declared image format.");
  return { bytes, mime, extension: mime === "image/jpeg" ? "jpg" : mime.slice(6), sha256: createHash("sha256").update(bytes).digest("hex") };
}

function safeImageReference(value) {
  if (!value || value.type !== "input" || typeof value.name !== "string" || !value.name || /[:\\/\u0000-\u001f]/.test(value.name)
    || [".", ".."].includes(value.name) || typeof value.subfolder !== "string" || /[:\\\u0000-\u001f]/.test(value.subfolder)
    || value.subfolder.startsWith("/") || value.subfolder.split("/").some(part => part === "." || part === "..")) {
    throw new Error("ComfyUI returned an unsafe uploaded image path.");
  }
  return { name: value.name, subfolder: value.subfolder, type: "input" };
}

function imageViewPath(file) {
  return `/view?${new URLSearchParams({ filename: file.name, type: "input", subfolder: file.subfolder })}`;
}

function verifyImageBytes(value, expectedSha256) {
  if (createHash("sha256").update(Buffer.from(value)).digest("hex") !== expectedSha256) {
    throw new Error("The ComfyUI starting image differs from the reviewed asset. No render was submitted and no existing image was overwritten.");
  }
}

function errorMessage(value) {
  const details = Object.entries(value?.node_errors ?? {}).flatMap(([id, node]) => (node.errors ?? []).map((error) => `${id}: ${error.message ?? error.type}${error.details ? ` (${error.details})` : ""}`));
  return [typeof value?.error === "string" ? value.error : value?.error?.message, ...details].filter(Boolean).join("; ").slice(0, 4000);
}

function videoOutputs(outputs = {}, endpoint = DIRECTOR_ENDPOINT) {
  const found = new Map();
  for (const node of Object.values(outputs)) for (const collection of [node.videos, node.gifs, node.images]) {
    for (const file of Array.isArray(collection) ? collection : []) {
      if (typeof file.filename !== "string" || !/\.(mp4|webm|mov|mkv)$/i.test(file.filename) || /[\\/]/.test(file.filename)) continue;
      const type = file.type === "temp" ? "temp" : "output";
      const query = new URLSearchParams({ filename: file.filename, subfolder: String(file.subfolder ?? ""), type });
      const url = `${endpoint}/view?${query}`;
      found.set(url, { filename: file.filename, url, type });
    }
  }
  return [...found.values()];
}
