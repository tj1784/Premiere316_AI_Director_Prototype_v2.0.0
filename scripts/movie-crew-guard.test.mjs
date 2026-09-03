import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { agentModelKey, assertExactIdAlreadyLoaded, loadMovieCrewProfile, readBoundedStdin, runMovieCrewCompletion, systemForAgent } from "./movie-crew-guard.mjs";
import { stageReleaseContract } from "./movie-crew-release.mjs";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const AGENTS = [
  "movie-screenwriter",
  "movie-screenplay-qa",
  "movie-prompt-engineer",
  "movie-screenwriter-qwen",
  "movie-screenplay-qa-qwen",
  "movie-prompt-engineer-qwen",
];

test("profiles pin exact catalog ids and keep Qwen optional", async () => {
  const profile = await loadMovieCrewProfile();
  assert.equal(agentModelKey(profile, "movie-screenwriter"), "llama-3.3-70b-instruct");
  assert.equal(agentModelKey(profile, "movie-screenplay-qa"), "llama-3.3-70b-instruct");
  assert.equal(agentModelKey(profile, "movie-prompt-engineer"), "llama-3.3-70b-instruct");
  assert.equal(agentModelKey(profile, "movie-screenwriter-qwen"), "qwen2.5-72b-instruct");
  assert.equal(profile.agents["movie-screenwriter-qwen"].default, false);
  assert.match(systemForAgent(profile, "movie-screenplay-qa"), /separate one-shot/);
});

test("direct Movie Crew profile launch routes through guard instead of native model", async () => {
  for (const agent of AGENTS) {
    const text = await readFile(join(".pi/agents", `${agent}.md`), "utf8");
    assert.match(text, /runner:\s*\n\s*type: external-cli/);
    assert.match(text, new RegExp(`args: \\[\"scripts/movie-crew-guard\\.mjs\", \"${agent}\"\\]`));
    assert.doesNotMatch(text, /^model:/m);
    assert.doesNotMatch(text, /^tools:/m);
    assert.doesNotMatch(text, /^thinking:/m);
  }
});

test("guard refuses completion unless native listing shows the exact id loaded", async () => {
  const seen = [];
  const fetchImpl = async (input, init) => {
    const url = String(input);
    seen.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/api/v1/models")) return json({ models: [{ key: "llama-3.3-70b-instruct", loaded_instances: [] }] });
    throw new Error(`unexpected ${url}`);
  };
  await assert.rejects(assertExactIdAlreadyLoaded(fetchImpl, "http://127.0.0.1:1234", "llama-3.3-70b-instruct"), /will not load/);
  assert.equal(seen.some((item) => item.includes("/v1/chat/completions")), false);
});

test("offline or unloaded guard path causes zero completion POSTs", async () => {
  const seen = [];
  const fetchImpl = async (input, init) => {
    const url = String(input);
    seen.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/api/v1/models")) return json({ models: [] });
    throw new Error(`unexpected ${url}`);
  };
  await assert.rejects(runMovieCrewCompletion({ agentId: "movie-screenwriter", prompt: "status", fetchImpl, endpoints: ["http://127.0.0.1:1234"] }), /not currently loaded|failed closed/);
  assert.equal(seen.filter((item) => item.includes("/v1/chat/completions")).length, 0);
});

test("guard posts completions only after loaded verification and never calls start/load endpoints", async () => {
  const seen = [];
  const fetchImpl = async (input, init) => {
    const url = String(input);
    seen.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/api/v1/models")) return json({ models: [{ key: "llama-3.3-70b-instruct", loaded_instances: [{ id: "i1" }] }] });
    if (url.endsWith("/v1/chat/completions")) return json({ choices: [{ message: { content: "ok" } }] });
    throw new Error(`unexpected ${url}`);
  };
  const result = await runMovieCrewCompletion({ agentId: "movie-screenwriter", prompt: "Write nothing; status only.", fetchImpl, endpoints: ["http://127.0.0.1:1234"] });
  assert.equal(result.choices[0].message.content, "ok");
  assert.equal(seen.some((item) => /models\/(?:load|start)|server\/start/i.test(item)), false);
  assert.equal(seen.filter((item) => item.startsWith("POST")).length, 1);
});

test("guard reads bounded stdin for external-cli prompt delivery", async () => {
  const prompt = await readBoundedStdin(Readable.from(["scene objective"]), 64);
  assert.equal(prompt, "scene objective");
  await assert.rejects(readBoundedStdin(Readable.from(["x".repeat(65)]), 64), /exceeds/);
});

test("stage release contract does not start or load models", async () => {
  const contract = await stageReleaseContract();
  assert.equal(contract.neverAutoLoad, true);
  assert.match(contract.physicalUnload, /explicit/);
});
