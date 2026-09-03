import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = resolve(ROOT, ".pi/movie-crew-profile.json");
const ENDPOINTS = ["http://127.0.0.1:1234", "http://127.0.0.1:1235"];
const MAX_STDIN_BYTES = 64 * 1024;

export async function readBoundedStdin(stream = process.stdin, maxBytes = MAX_STDIN_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.length;
    if (total > maxBytes) throw new Error(`Movie Crew prompt exceeds ${maxBytes} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function loadMovieCrewProfile(path = PROFILE) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function agentModelKey(profile, agentId) {
  const agent = profile.agents?.[agentId];
  if (!agent?.modelKey) throw new Error(`Unknown Movie Crew agent ${agentId}`);
  return agent.modelKey;
}

export function systemForAgent(profile, agentId) {
  const agent = profile.agents?.[agentId];
  if (!agent) throw new Error(`Unknown Movie Crew agent ${agentId}`);
  const family = agent.family === "qwen" ? "optional Qwen alternate" : "default Llama";
  if (agent.role === "writer") return `You are ${agentId}, a ${family} Premiere316 screenwriter. Return Fountain only for the supplied scope. Do not perform QA or prompt compilation.`;
  if (agent.role === "qa-critic") return `You are ${agentId}, a separate one-shot ${family} screenplay QA / Story Doctor. Critique first. Return JSON findings only. Never mutate Fountain.`;
  return `You are ${agentId}, a separate one-shot ${family} prompt engineer. Compile derivative engine prompts from canonical specs only. Never generate media.`;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export async function assertExactIdAlreadyLoaded(fetchImpl, endpoint, modelKey) {
  const response = await fetchImpl(`${endpoint}/api/v1/models`);
  if (!response.ok) throw new Error("LM Studio native model status is unavailable. Premiere316 will not auto-load.");
  const data = asObject(await response.json());
  const rows = Array.isArray(data.models) ? data.models : [];
  const match = rows.map(asObject).find((row) => String(row.id ?? row.key ?? "") === modelKey);
  const instances = Array.isArray(match?.loaded_instances) ? match.loaded_instances : [];
  if (!match || instances.length === 0) throw new Error(`The exact served model ${modelKey} is not currently loaded. Guard will not load it.`);
  return match;
}

function refusesStartOrLoadCommand(text) {
  return /\b(lms\s+(?:server\s+)?start|lms\s+load|start\s+lm\s*studio|auto-?load|load\s+the\s+model)\b/i.test(text);
}

export async function runMovieCrewCompletion({
  agentId,
  system,
  prompt,
  fetchImpl = fetch,
  endpoints = ENDPOINTS,
  profilePath = PROFILE,
} = {}) {
  if (!agentId) throw new Error("Movie Crew agent id is required.");
  if (refusesStartOrLoadCommand(`${system ?? ""}\n${prompt ?? ""}`)) throw new Error("Movie Crew guard refuses model start/load instructions.");
  const profile = await loadMovieCrewProfile(profilePath);
  const modelKey = agentModelKey(profile, agentId);
  const systemPrompt = system ?? systemForAgent(profile, agentId);
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      await assertExactIdAlreadyLoaded(fetchImpl, endpoint, modelKey);
      const response = await fetchImpl(`${endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: modelKey,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: String(prompt ?? "") },
          ],
          stream: false,
        }),
      });
      if (!response.ok) throw new Error(`Completion failed (${response.status}).`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Movie Crew guard failed closed.");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const agentId = process.argv[2];
  if (!agentId) {
    console.error("Usage: node scripts/movie-crew-guard.mjs <agent-id>");
    process.exit(2);
  }
  readBoundedStdin().then((prompt) => runMovieCrewCompletion({
    agentId,
    prompt: prompt || "Status check only. Do not generate a screenplay.",
  })).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
