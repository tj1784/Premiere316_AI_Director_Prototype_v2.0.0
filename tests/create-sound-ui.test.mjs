import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const COMPONENT_FILE = fileURLToPath(new URL("../client/src/components/CreateSoundWorkspace.tsx", import.meta.url));
const source = fs.readFileSync(COMPONENT_FILE, "utf8");
const syntax = ts.createSourceFile(COMPONENT_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const WORKFLOW_COMPONENT_FILE = fileURLToPath(new URL("../client/src/components/SoundWorkflowWorkspace.tsx", import.meta.url));
const workflowSource = fs.readFileSync(WORKFLOW_COMPONENT_FILE, "utf8");

function visit(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node);
  ts.forEachChild(node, (child) => {
    visit(child, predicate, matches);
  });
  return matches;
}

function objectProperty(object, name) {
  assert.ok(ts.isObjectLiteralExpression(object), `${name} must be read from an object literal`);
  return object.properties.find((property) => property.name?.getText(syntax).replace(/^['"]|['"]$/g, "") === name);
}

function variableInitializer(name) {
  return visit(syntax, (node) => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === name
  ))[0]?.initializer;
}

function languageValues(providerName) {
  const languages = variableInitializer("TTS_LANGUAGES");
  assert.ok(languages && ts.isObjectLiteralExpression(languages));
  const provider = objectProperty(languages, providerName);
  assert.ok(ts.isPropertyAssignment(provider) && ts.isArrayLiteralExpression(provider.initializer));
  return provider.initializer.elements.map((element) => {
    assert.ok(ts.isObjectLiteralExpression(element));
    const value = objectProperty(element, "value");
    assert.ok(ts.isPropertyAssignment(value) && ts.isStringLiteral(value.initializer));
    return value.initializer.text;
  });
}

test("Create Sound defaults voice cloning to standalone QwenTTS", () => {
  const defaultDraft = visit(syntax, (node) => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "DEFAULT_DRAFT"
  ))[0];
  assert.ok(defaultDraft?.initializer, "DEFAULT_DRAFT must exist");
  const provider = objectProperty(defaultDraft.initializer, "provider");
  assert.ok(ts.isPropertyAssignment(provider));
  assert.equal(provider.initializer.getText(syntax), '"qwenTts"');

  assert.match(source, /\["qwenTts",\s*"indexTts"\]/, "provider selector must present Qwen before Index");
  assert.match(source, /Primary standalone voice-cloning model/);
  assert.match(source, /Standalone fallback voice-cloning model/);
});

test("Qwen and Index retain separate standalone health and generation routes", () => {
  assert.match(source, /\/api\/sound\/qwen-tts\/health/);
  assert.match(source, /\/sound\/qwen-tts\/generations/);
  assert.match(source, /\/sound\/index-tts\/generations/);
  assert.match(source, /providers\?\.\[providerId\]/);
  assert.doesNotMatch(source, /\/api\/.*comfy/i, "Create Sound voice cloning must not call ComfyUI");
});

test("Qwen upload requires and posts the exact reference transcript", () => {
  assert.match(source, /Exact reference transcript/);
  assert.match(source, /body\.set\("referenceTranscript",\s*draft\.referenceTranscript\.trim\(\)\)/);
  assert.match(source, /draft\.provider === "qwenTts" && !draft\.referenceTranscript\.trim\(\)/);
  assert.match(source, /One generation · no splitting/);
  assert.match(source, /No splitting or stitching will be used/);
});

test("Qwen accepts only WAV references while Index retains broader audio uploads", () => {
  assert.match(source, /draft\.provider === "qwenTts" \? "audio\/wav,audio\/x-wav,\.wav" : "audio\/\*,\.wav,\.mp3,\.flac,\.m4a,\.ogg"/);
  assert.match(source, /QwenTTS accepts WAV reference audio only/);
  assert.match(source, /draft\.provider === "qwenTts" && !isWavReference\(referenceFile\)/);
  assert.match(source, /WAV required · exactly 8–15 seconds/);
});

test("provider language lists match the standalone engines", () => {
  assert.deepEqual(languageValues("qwenTts"), ["AUTO", "EN", "ZH", "JA", "KO", "DE", "FR", "RU", "PT", "ES", "IT"]);
  assert.deepEqual(languageValues("indexTts"), ["EN", "ZH", "JA", "ES", "AR"]);
  assert.equal(languageValues("qwenTts").includes("AR"), false, "Qwen must not advertise unsupported Arabic generation");
});

test("Qwen exposes reference prosody honestly and keeps Index-only controls out of its request", () => {
  assert.match(source, /Editorial performance note/);
  assert.match(source, /this note does not steer synthesis/);
  assert.match(source, /Emotion-weight and speed controls are available only with IndexTTS/);
  assert.match(source, /if \(draft\.provider === "indexTts"\) \{\s*body\.set\("emotionWeight"/);
  assert.match(source, /body\.set\("durationFactor"/);
});

test("Workflow Manager uses the dedicated copy-only management routes", () => {
  assert.match(workflowSource, /sound\/workflows\/import/);
  assert.match(workflowSource, /sound\/workflows\/\$\{encodeURIComponent\(profileId\(selectedProfile\)\)\}\/enabled/);
  assert.match(workflowSource, /sound\/workflows\/\$\{encodeURIComponent\(profileId\(selectedProfile\)\)\}\/name/);
  assert.match(workflowSource, /sound\/workflows\/\$\{encodeURIComponent\(profileId\(selectedProfile\)\)\}\/rebind/);
  assert.match(workflowSource, /apiWorkflowPath: apiWorkflowPath\.trim\(\)/);
  assert.match(workflowSource, /apiWorkflow: parseJsonEditor\(apiWorkflowJson, "API workflow", \{\}\)/);
  assert.match(workflowSource, /form\.set\("workflowFile",\s*file,\s*file\.name\)/);
  assert.match(workflowSource, /JSON\.stringify\(\{ sourcePath, \.\.\.importManifest\(\) \}\)/);
  assert.match(workflowSource, /parseInputBindings\(importInputBindingsJson, "Import input bindings"\)/);
  assert.match(workflowSource, /parseOutputBindings\(importOutputBindingsJson, "Import output bindings"\)/);
  assert.match(workflowSource, /Imports are copy-only and always start disabled/);
  assert.match(workflowSource, /The source workflow and its checksum are read-only/);
});

test("Workflow Manager exposes mutations only when the server advertises them", () => {
  assert.match(workflowSource, /snapshot\.management\?\.importWorkflow === true \|\| snapshot\.management\?\.import === true/);
  assert.match(workflowSource, /snapshot\.management\?\.enableDisable === true/);
  assert.match(workflowSource, /snapshot\.management\?\.rename === true/);
  assert.match(workflowSource, /snapshot\.management\?\.rebind === true/);
  assert.match(workflowSource, /\{canRename \? <div className="sound-workflow-inline-control"/);
  assert.match(workflowSource, /\{canEnableDisable \? <div className="sound-workflow-inline-control"/);
  assert.match(workflowSource, /\{canRebind \? <details className="sound-workflow-rebind"/);
});

test("Workflow Manager retains selectable scan candidates and reports action errors", () => {
  assert.match(workflowSource, /const \[candidates, setCandidates\] = useState/);
  assert.match(workflowSource, /if \(Array\.isArray\(json\.candidates\)\)/);
  assert.match(workflowSource, /if \(sourcePath\) return `path:\$\{sourcePath\.replace\(\/\\\\\/g, "\/"\)\.toLowerCase\(\)\}`/);
  assert.match(workflowSource, /\[candidate\?\.reason, candidate\?\.error\]/);
  assert.match(workflowSource, /return `discovery:\$\{name\}\\u001f\$\{detail\}`/);
  assert.match(workflowSource, /onClick=\{\(\) => setManagerProfileId\(profileId\(profile\)\)\}/);
  assert.match(workflowSource, /onClick=\{\(\) => setSelectedCandidateId\(candidateId\)\}/);
  assert.match(workflowSource, /candidate\.error \|\| candidate\.reason \|\| candidate\.status/);
  assert.match(workflowSource, /selectedCandidate\.sha256 \|\| "Not reported"/);
  assert.match(workflowSource, /selectedCandidate\.schemaType \|\| "Unknown"/);
  assert.match(workflowSource, /selectedCandidate\.relevant === true \? "Yes"/);
  assert.match(workflowSource, /selectedCandidate\.nodeClasses\.join\(", "\)/);
  assert.match(workflowSource, /profile\?\.outputBindings \|\| profile\?\.outputNodeBindings \|\| profile\?\.outputs/);
  assert.match(workflowSource, /!token\(key\)\.startsWith\("output"\)/);
  assert.match(workflowSource, /setImportInputBindingsJson\("\{\}"\)/);
  assert.match(workflowSource, /setImportOutputBindingsJson\("\[\]"\)/);
  assert.match(workflowSource, /sound-workflow-drawer-message error" role="alert"/);
});

test("hidden workflow tabs do not fetch or decode waveforms", () => {
  assert.match(workflowSource, /function AudioWaveform\(\{ src, enabled \}/);
  assert.match(workflowSource, /if \(!src \|\| !enabled \|\| !canvasRef\.current\) return/);
  assert.match(workflowSource, /\}, \[src, enabled\]\)/);
  assert.match(workflowSource, /<AudioWaveform src=\{url\} enabled=\{active\} \/>/);
  assert.match(workflowSource, /<audio controls preload="metadata" src=\{url\} \/>/);
});
