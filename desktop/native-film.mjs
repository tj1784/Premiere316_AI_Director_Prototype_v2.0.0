import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function validateFilmRequest(input) {
  if (!input || typeof input.pictureId !== "string" || !input.pictureId || input.pictureId.length > 200) throw new Error("A saved picture is required.");
  if (!Array.isArray(input.shots) || !input.shots.length || input.shots.length > 36) throw new Error("Choose between 1 and 36 shots.");
  const text = (value, max) => { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Missing or oversized film text."); return value.trim(); };
  const seen = new Set();
  const shots = input.shots.map((shot, index) => {
    if (!Number.isFinite(shot.seconds) || shot.seconds < 5 || shot.seconds > 15) throw new Error("Native H3 shots must last 5–15 seconds.");
    const sourceShotId = text(shot.id, 200);
    if (seen.has(sourceShotId)) throw new Error("Duplicate shot.");
    seen.add(sourceShotId);
    return { id: String(index + 1).padStart(2, "0"), sourceShotId, seconds: shot.seconds, prompt: text(shot.prompt, 4000) };
  });
  const durationSeconds = shots.reduce((sum, shot) => sum + shot.seconds, 0);
  if (durationSeconds > 180) throw new Error("A render is limited to three minutes.");
  const writer = input.writer ? { modelId: text(input.writer.modelId, 300), generatedAt: Number(input.writer.generatedAt), rawResponse: text(input.writer.rawResponse, 100_000) } : null;
  const promptEditedAt = Number.isFinite(input.promptEditedAt) && input.promptEditedAt > 0 ? input.promptEditedAt : null;
  return { schemaVersion: 1, pictureId: input.pictureId, title: text(input.title, 200), visualContinuity: text(input.visualContinuity, 4000), writer, promptEditedAt, shots, durationSeconds, fps: 24, seed: 3161400, origin: "native-generated", mode: "text-to-video", thinking: false, screenplayQa: false };
}

export function createNativeFilmService({ root, workerRoot, python, buildInfo }) {
  let active = null;
  const folder = (jobId) => { if (!/^[a-f0-9]{64}$/.test(jobId ?? "")) throw new Error("Invalid render id."); return join(root, jobId); };
  function status(jobId) {
    const dir = folder(jobId);
    if (!existsSync(join(dir, "request.json"))) throw new Error("Render not found.");
    const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
    let state = existsSync(join(dir, "status.json")) ? JSON.parse(readFileSync(join(dir, "status.json"), "utf8")) : { stage: "starting", totalShots: request.shots.length, targetSeconds: request.durationSeconds, playableShots: 0 };
    if (active?.id !== jobId && !["failed", "render_complete_pending_visual_review"].includes(state.stage)) state = { ...state, stage: "interrupted", error: "Render stopped. Resume uses completed shots." };
    const clips = request.shots.flatMap((shot) => {
      const file = join(dir, `shot-${shot.id}.mp4`);
      if (!existsSync(file)) return [];
      const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
      const provenance = { origin: "native-generated", engine: "minimax-h3", jobId, requestHash: jobId, promptWriter: request.writer?.modelId ?? null, promptEditedAt: request.promptEditedAt ?? null, modelResponseHash: request.writer ? createHash("sha256").update(request.writer.rawResponse).digest("hex") : null, sourceShotId: shot.sourceShotId, prompt: `${request.visualContinuity}\n${shot.prompt}`, sha256, seconds: shot.seconds, fps: 24, buildInfo, createdAt: statSync(file).mtime.toISOString() };
      const sidecar = `${file}.provenance.json`;
      if (!existsSync(sidecar)) writeFileSync(sidecar, JSON.stringify(provenance, null, 2));
      return [{ id: shot.id, sourceShotId: shot.sourceShotId, seconds: shot.seconds, prompt: shot.prompt, sha256, mediaUri: `media://films/${jobId}/shot-${shot.id}.mp4` }];
    });
    return { ok: true, jobId, ...state, running: active?.id === jobId, clips, movieUri: state.stage === "render_complete_pending_visual_review" && existsSync(join(dir, "movie.mp4")) ? `media://films/${jobId}/movie.mp4` : null };
  }
  function start(input) {
    const request = validateFilmRequest(input);
    const id = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    if (active) { if (active.id === id) return status(id); throw new Error("Another movie is rendering. Stop it before starting another."); }
    const dir = folder(id);
    mkdirSync(dir, { recursive: true });
    const requestFile = join(dir, "request.json");
    writeFileSync(requestFile, JSON.stringify(request, null, 2));
    const statePath = join(dir, "status.json");
    if (existsSync(statePath) && JSON.parse(readFileSync(statePath, "utf8")).stage === "render_complete_pending_visual_review") return status(id);
    writeFileSync(statePath, JSON.stringify({ stage: "starting", totalShots: request.shots.length, targetSeconds: request.durationSeconds }));
    const env = { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PYTHONUNBUFFERED: "1" };
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "HF_TOKEN", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) delete env[key];
    const child = spawn(python, [join(workerRoot, "native_h3_film.py"), requestFile], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
    active = { id, child };
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => appendFileSync(join(dir, "worker.log"), chunk));
    child.on("error", (error) => { writeFileSync(statePath, JSON.stringify({ stage: "failed", error: error.message })); active = null; });
    child.on("exit", (code) => {
      if (code !== 0) { const last = JSON.parse(readFileSync(statePath, "utf8")); writeFileSync(statePath, JSON.stringify({ ...last, stage: "failed", error: last.error || `Video worker stopped (${code}). Completed shots are saved.` })); }
      if (active?.id === id) active = null;
    });
    return status(id);
  }
  function stop() { if (active) active.child.kill(); return { ok: true }; }
  return { start, status, stop };
}
