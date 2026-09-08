import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { livePackagedUatPassed } from "./pre-audit-evidence.mjs";

const directory = new URL("../screenshots/final-pre-audit-intake-and-lmstudio/", import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, directory), "utf8"));
const save = (name, value) => writeFile(new URL(name, directory), `${JSON.stringify(value, null, 2)}\n`);
const events = (await readFile(new URL("lm-studio-server.jsonl", directory), "utf8")).split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const reports = {};
for (const mode of ["online", "offline"]) {
  const report = await read(`lm-studio-${mode}-uat.json`);
  const renderer = await read(`${mode}-renderer-network.json`);
  // Early observer run predates startedAt. Its only live request window is
  // bounded by the saved movie plan timestamp and recorded server log.
  const start = report.startedAt ?? report.flow?.lastRunAt ?? 0;
  const observed = events.filter((event) => event.timestamp >= start && (!report.endedAt || event.timestamp <= report.endedAt));
  const requests = observed.filter((event) => /Received request: POST to \/v1\/chat\/completions/.test(event.data?.content));
  const calls = mode === "online" ? requests.map((event) => ({ timestamp: event.timestamp, model: event.data.content.match(/"model":\s*"([^"]+)"/)?.[1] ?? null, system: event.data.content.match(/"content":\s*"([^"\n]+)"/)?.[1] ?? null })) : [];
  const external = renderer.filter(({ url }) => /^https?:/.test(url) && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  report.actualProviderCalls = calls.length;
  report.providerModels = [...new Set(calls.map((call) => call.model))];
  report.providerCalls = calls;
  report.noSilentFallback = mode === "online" && report.flow?.servedModelId === "llama-3.3-70b-instruct" && report.providerModels.length === 1 && report.providerModels[0] === "llama-3.3-70b-instruct";
  report.functionalPassed = mode === "offline"
    ? report.offlineHonest && report.noDraftReady && report.assetsBlocked && report.errors.length === 0
    : report.onlineVerified && report.researchGenerated && report.screenplayGenerated && report.qaGenerated && report.assetsExtracted && report.assetsVisible && report.errors.length === 0;
  report.network = { verified: mode === "online" ? calls.length > 0 : true, cloud: external.filter(({url}) => /openai|anthropic|openrouter|api\.x\.ai/.test(url)).length, web: external.length, comfy: renderer.filter(({url}) => /comfy/i.test(url)).length, port8188: renderer.filter(({url}) => /:8188/.test(url)).length, external, scope: "Renderer requests, LM Studio server logs, and npm test/pack source guards. No OS-wide packet capture; other server egress is not independently traced." };
  report.ok = Boolean(report.functionalPassed && report.network.web === 0 && report.network.cloud === 0 && report.network.comfy === 0 && report.network.port8188 === 0);
  report.greenEligible = mode === "online" && livePackagedUatPassed(report);
  report.status = report.greenEligible ? "LIVE_PACKAGED_LM_STUDIO_UAT_PASSED" : "FINAL_PRE_AUDIT_NOT_GREEN";
  await save(`lm-studio-${mode}-uat.json`, report);
  reports[mode] = report;
}
const proof = { ok: false, greenEligible: reports.online.greenEligible, buildId: reports.online.build.buildId,
  noCloudInferenceObserved: [reports.online, reports.offline].every((report) => report.network.cloud === 0),
  noComfyObserved: [reports.online, reports.offline].every((report) => report.network.comfy === 0),
  no8188Observed: [reports.online, reports.offline].every((report) => report.network.port8188 === 0),
  noWeb: [reports.online, reports.offline].every((report) => report.network.web === 0),
  actualProviderCalls: reports.online.actualProviderCalls, providerModels: reports.online.providerModels,
  externalUrls: [...new Set([...reports.online.network.external, ...reports.offline.network.external].map(({url}) => url))],
  scope: reports.online.network.scope,
  sourceChecks: "npm test: no-cloud-runtime, model selection, phase-review, and pipeline guards; electron:pack: forbidden legacy runtime markers audit",
  knownLimitation: "Packaged renderer requests the existing Grok branding extension; strict no-web requirement is not satisfied." };
proof.ok = proof.noCloudInferenceObserved && proof.noComfyObserved && proof.no8188Observed && proof.noWeb;
await save("no-cloud-no-web-no-comfy-no-8188-proof.json", proof);
console.log(JSON.stringify({ directory: fileURLToPath(directory), onlineFunctionalPassed: reports.online.functionalPassed, offlineFunctionalPassed: reports.offline.functionalPassed, greenEligible: reports.online.greenEligible, proof }, null, 2));
