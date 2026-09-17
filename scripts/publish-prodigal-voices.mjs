/** Attach only finished, verified Qwen voice auditions to the existing Prodigal cast. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folder = join(root, "public/pictures/prodigal-son/voice-designs");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const expectedSource = "b44704444023df54cc940ad2a619ecda68ee6b35eec650284ef509da2c6f3b32";
const modelId = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign";
const draft = readJson(join(root, "screenshots/prodigal-voice-design-draft.json"));
const run = readJson(join(folder, "run-results.json"));
const transcriptPath = join(folder, "transcript-checks.json");
const transcripts = existsSync(transcriptPath) ? readJson(transcriptPath) : null;
const screenplay = readFileSync(join(root, "public/pictures/prodigal-son/Prodigal_Son.fountain"));
const assets = readJson(join(root, "public/pictures/prodigal-son/assets.json"));
if (!draft.complete) throw new Error("The cast design is not complete.");
if (sha(screenplay) !== expectedSource || run.sourceSha256 !== expectedSource || run.modelId !== modelId) throw new Error("The voice batch does not match the approved screenplay/model.");
const characterIds = new Set(assets.filter((asset) => ["Character", "Extras", "Featured extra"].includes(asset.category)).map((asset) => asset.id));
const byProfile = new Map(draft.profiles.map((profile) => [profile.profileId, profile]));
if (byProfile.size !== draft.profiles.length) throw new Error("Duplicate voice profile IDs.");
const results = new Map(run.results.map((result) => [result.profileId, result]));
const verifiedFiles = new Map();

function sampleFor(profile) {
  const source = profile.aliasOfProfileId ? byProfile.get(profile.aliasOfProfileId) : profile;
  if (!source || source.aliasOfProfileId) throw new Error(`Invalid shared voice: ${profile.profileId}`);
  const result = results.get(source.profileId);
  if (result?.status !== "completed" || !result.quality?.passed || !result.fileName || result.text !== source.text || result.voiceDesign !== source.voiceDesign) throw new Error(`A matching generated sample is missing: ${source.profileId}`);
  if (transcripts && !transcripts.results.some((check) => check.profileId === source.profileId && check.audioSha256 === result.sha256 && check.status === "completed")) throw new Error(`A matching transcript check is missing: ${source.profileId}`);
  if (profile.aliasOfProfileId && (profile.text !== source.text || profile.voiceDesign !== source.voiceDesign)) throw new Error(`Shared voice description/text differs from its source: ${profile.profileId}`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.wav$/.test(result.fileName)) throw new Error(`Invalid sample filename: ${source.profileId}`);
  if (verifiedFiles.has(result.fileName)) return verifiedFiles.get(result.fileName);
  const data = readFileSync(join(folder, result.fileName));
  if (sha(data) !== result.sha256 || data.length !== result.bytes || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") throw new Error(`Generated WAV failed integrity check: ${result.fileName}`);
  if (result.sampleRate !== 24000 || result.channels !== 1 || !(result.durationSeconds > 0) || !Number.isSafeInteger(result.seed)) throw new Error(`Generated sample metadata is invalid: ${source.profileId}`);
  const generatedAt = typeof result.finishedAt === "number" ? result.finishedAt : Date.parse(result.finishedAt);
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) throw new Error(`Generated timestamp is missing: ${source.profileId}`);
  const sample = {
    id: `qwen-voice:${source.profileId}:${result.sha256}`,
    mediaUri: `/pictures/prodigal-son/voice-designs/${result.fileName}`,
    sha256: result.sha256, bytes: result.bytes, durationSec: result.durationSeconds,
    sampleRate: result.sampleRate, generatedAt, seed: result.seed,
  };
  verifiedFiles.set(result.fileName, sample);
  return sample;
}

const profiles = draft.profiles.map((profile) => {
  if (!characterIds.has(profile.assetId)) throw new Error(`Voice has no existing character sheet: ${profile.assetId}`);
  if (!["screenplay", "audition"].includes(profile.textKind)) throw new Error(`Voice text provenance is missing: ${profile.profileId}`);
  if (profile.textKind === "screenplay") {
    if (!profile.cueRefs?.length || profile.cueRefs.some((cue) => !screenplay.toString("utf8").includes(cue.text))) throw new Error(`Sample quote is absent from the screenplay: ${profile.profileId}`);
    if (profile.text !== profile.cueRefs.map((cue) => cue.text).join("\n\n")) throw new Error(`Sample differs from its screenplay excerpts: ${profile.profileId}`);
  }
  const listeningNote = transcripts?.results.find((check) => check.profileId === profile.profileId)?.listeningReviewNote;
  const reviewNote = [profile.sourceConflict, listeningNote].filter(Boolean).join(" ");
  return {
    id: profile.profileId, characterId: profile.assetId, name: profile.name,
    ...(profile.memberId.startsWith("member-") ? { memberLabel: `Member ${profile.memberId.slice(7).toUpperCase()}` } : {}),
    role: profile.role, designPrompt: profile.voiceDesign, sampleText: profile.text, textKind: profile.textKind,
    ...(reviewNote ? { reviewNote } : {}),
    sceneIds: [...new Set(profile.textKind === "screenplay" ? profile.cueRefs.map((cue) => cue.sceneId) : profile.inventorySceneIds)],
    ...(profile.aliasOfProfileId ? { aliasOf: profile.aliasOfProfileId } : {}),
    sample: sampleFor(profile),
  };
});
const covered = new Set(profiles.map((profile) => profile.characterId));
const missing = [...characterIds].filter((id) => !covered.has(id));
if (missing.length) throw new Error(`Character sheets missing voices: ${missing.join(", ")}`);
if (profiles.length !== 55 || verifiedFiles.size !== 54 || covered.size !== 30) throw new Error("Expected 55 attachments, 54 unique generated voices and 30 character sheets.");
const manifest = { schemaVersion: 1, id: "prodigal-son-qwen-voice-designs-v1", pictureId: draft.pictureId, screenplaySha256: expectedSource, modelId, profiles };
const json = JSON.stringify(manifest, null, 2);
writeFileSync(join(folder, "manifest.json"), `${json}\n`, "utf8");
writeFileSync(join(folder, "cast-design.json"), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
writeFileSync(join(root, "src/lib/studio/bundled-pictures/prodigal-son/voices.ts"), `import type { CharacterVoiceDesignManifest } from "../../character-voice-designs.ts";\n\n// Real local Qwen VoiceDesign outputs. Importing attaches candidates pending user review.\nexport const PRODIGAL_VOICE_DESIGNS: CharacterVoiceDesignManifest = ${json};\n`, "utf8");
const notes = [
  "# The Prodigal Son — voice auditions", "",
  `Generated ${verifiedFiles.size} distinct voices with ${modelId}; attached ${profiles.length} profiles to ${covered.size} existing character sheets.`, "",
  "Every attachment starts awaiting the user's review. No voice is approved or assigned as final casting by this batch. Existing screenplay, character images and image approvals are preserved.", "",
  "The 10 speaking characters use exact excerpts from the approved screenplay. Other samples contain clearly labeled audition-only prose, not additional movie dialogue. Multiple excerpts are an audition montage, not a new scene. The Pharisee and hillside-listener member B are the same person and reuse one WAV.", "",
  `Approved screenplay SHA-256: ${expectedSource}`, "",
  "The model and all generation ran locally. Exact instructions, seeds, model files, settings and signal checks are recorded in run-results.json. Voice descriptions express creative casting choices, not a reconstruction of an ancient English accent.", "",
  ...(transcripts ? ["Automatic transcript checks are recorded in transcript-checks.json and are separate from the user's listening and casting review.", ""] : []),
  ...profiles.filter((profile) => profile.reviewNote).map((profile) => `Casting note — ${profile.name}: ${profile.reviewNote}`), "",
  "| Character / member | Text | Sample |", "| --- | --- | --- |",
  ...profiles.map((profile) => `| ${profile.name.replaceAll("|", "/")} | ${profile.textKind === "screenplay" ? "Screenplay excerpt" : "Audition only"} | [Listen](${profile.sample.mediaUri.split("/").at(-1)}) |`), "",
].join("\n");
writeFileSync(join(folder, "README.md"), notes, "utf8");
console.log(JSON.stringify({ profiles: profiles.length, uniqueWavs: verifiedFiles.size, characterSheets: covered.size, totalSeconds: [...verifiedFiles.values()].reduce((sum, sample) => sum + sample.durationSec, 0), manifest: join(folder, "manifest.json") }, null, 2));
