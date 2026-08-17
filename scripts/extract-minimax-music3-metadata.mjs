import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [, , sourceArg, outputArg] = process.argv;
if (!sourceArg || !outputArg) {
  throw new Error("Usage: node scripts/extract-minimax-music3-metadata.mjs <source.flac> <output-directory>");
}

const source = path.resolve(sourceArg);
const output = path.resolve(outputArg);
const probe = JSON.parse(execFileSync("ffprobe", [
  "-v", "error", "-show_streams", "-show_format", "-of", "json", source
], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const tags = probe.format?.tags || {};
if (!tags.prompt || !tags.workflow) throw new Error("FLAC does not contain ComfyUI prompt/workflow metadata");

const apiPrompt = JSON.parse(tags.prompt);
const workflow = JSON.parse(tags.workflow);
const musicNode = apiPrompt["37:13"];
if (musicNode?.class_type !== "MiniMaxMusic3TextEncode") {
  throw new Error("Embedded API prompt does not contain expected MiniMax Music 3 node 37:13");
}

const hash = crypto.createHash("sha256");
hash.update(fs.readFileSync(source));
const stat = fs.statSync(source);
const sourceInfo = {
  schema: "premiere316.embedded-minimax-music3.v1",
  sourceFile: source,
  bytes: stat.size,
  sha256: hash.digest("hex"),
  durationSeconds: Number(probe.format.duration),
  codec: probe.streams?.[0]?.codec_name,
  sampleRate: Number(probe.streams?.[0]?.sample_rate),
  channels: Number(probe.streams?.[0]?.channels),
  workflowId: workflow.id,
  caption: musicNode.inputs.caption,
  lyrics: musicNode.inputs.lyrics,
  seed: apiPrompt["37:38"]?.inputs?.seed,
  maxDuration: musicNode.inputs.max_duration,
  model: apiPrompt["37:6"]?.inputs?.unet_name,
  textEncoder: apiPrompt["37:3"]?.inputs?.clip_name,
  vae: apiPrompt["37:7"]?.inputs?.vae_name,
  cfg: apiPrompt["37:9"]?.inputs?.cfg,
  steps: apiPrompt["37:9"]?.inputs?.steps,
  sampler: apiPrompt["37:9"]?.inputs?.sampler_name,
  scheduler: apiPrompt["37:9"]?.inputs?.scheduler
};

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "source-audio-metadata.json"), `${JSON.stringify(sourceInfo, null, 2)}\n`);
fs.writeFileSync(path.join(output, "source-api-prompt.json"), `${JSON.stringify(apiPrompt, null, 2)}\n`);
fs.writeFileSync(path.join(output, "source-workflow.json"), `${JSON.stringify(workflow, null, 2)}\n`);
fs.writeFileSync(path.join(output, "lyrics.txt"), `${String(musicNode.inputs.lyrics || "").replace(/^\s*```text\s*/i, "").replace(/\s*```\s*$/i, "").trim()}\n`);

console.log(JSON.stringify({ output, ...sourceInfo }, null, 2));
