import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(root, "screenshots", "remove-research-mode-options-entirely");
const forbidden = [
  { id: "web-assisted", pattern: /web-assisted|web assisted/i },
  { id: "research-mode", pattern: /research mode/i },
  { id: "local-research", pattern: /local research(?: room)?/i },
  { id: "local-model-research", pattern: /local model research/i },
  { id: "mode-heading", pattern: />Mode</ },
  { id: "research-mode-select", pattern: /aria-label="Research mode"/ },
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) walk(full, acc);
    else if (/\.(tsx|ts)$/.test(name.name)) acc.push(full);
  }
  return acc;
}

const files = [
  ...walk(join(root, "src/components/research")),
  join(root, "src/components/studio/advanced-departments.tsx"),
  join(root, "src/components/studio/stage-views.tsx"),
];

const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const item of forbidden) {
    if (item.pattern.test(text)) hits.push({ file: relative(root, file).replaceAll("\\", "/"), id: item.id });
  }
}

const workspace = readFileSync(join(root, "src/components/research/research-workspace.tsx"), "utf8");
const proof = {
  ok: hits.length === 0 && /Build Research Draft|RESEARCH_ROOM_PRIMARY_CTA/.test(workspace) && /data-research-mode-panel="false"/.test(workspace),
  hits,
  primaryCtaPresent: /Build Research Draft|RESEARCH_ROOM_PRIMARY_CTA/.test(workspace),
  modePanelAbsent: /data-research-mode-panel="false"/.test(workspace),
  dropdownAbsent: !/aria-label="Research mode"/.test(workspace),
  scanned: files.map((file) => relative(root, file).replaceAll("\\", "/")),
};

test("user-facing research UI has no MODE, web-assisted, or local option strings", () => {
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "string-scan-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
  assert.equal(proof.ok, true, JSON.stringify(hits, null, 2));
});
