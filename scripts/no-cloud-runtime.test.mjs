import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("director runtime fails closed outside packaged prepared-asset inference", () => {
  const director = source("src/lib/ai/director.ts");
  assert.match(director, /prepared-asset workflow/);
  assert.match(director, /ok: false/);
  assert.doesNotMatch(director, /exposeLocalStill|ensureLocalEngine|desktopGeneratePreparedImage/);
  assert.doesNotMatch(director, /api\.x\.ai|XAI_API_KEY|grok-imagine-video|videos\/generations|\/tts\b/);
  assert.doesNotMatch(director, /writePicture|polishPrompts|startClip|pollClip|speakLine|writeScore|askDirector/);
});

test("studio actions cannot invoke removed hosted director operations", () => {
  const surfaces = [
    source("src/lib/studio/use-director.ts"),
    source("src/components/studio/shell.tsx"),
    source("src/components/studio/inspector.tsx"),
    source("src/components/studio/stage-views.tsx"),
  ].join("\n");
  assert.doesNotMatch(surfaces, /writePicture|polishPrompts|startClip|pollClip|speakLine|writeScore|askDirector/);
  assert.doesNotMatch(surfaces, /<Button[^>]*>\s*(Rewrite|Animate 10–15s|Ask|Spot the picture|Rewrite cue sheet|I2V)\s*<\/Button>/);
  assert.match(surfaces, /no cloud fallback/i);
});

test("Stitch owns dedicated media and clip panels", () => {
  const shell = source("src/components/studio/shell.tsx");
  const panels = source("src/components/studio/stitch-panels.tsx");
  assert.match(shell, /kind === "media" \? <MediaBin \/> : <Bin \/>/);
  assert.match(shell, /kind === "clip" \? <ClipInspector \/> : <Inspector \/>/);
  assert.match(panels, /data-panel-kind="media"/);
  assert.match(panels, /data-panel-kind="clip"/);
  assert.doesNotMatch(panels, /useDirector|Generate still|Animate|api\.x\.ai/);
});

test("packaged stage harness uses responsive controls and writes failure evidence", () => {
  const rail = source("src/components/studio/stage-views.tsx");
  const harness = source("scripts/desktop-stage-visual.mjs");
  assert.match(rail, /aria-current=\{stage === item\.id \? "step"/);
  assert.match(rail, /aria-label="Pipeline stage"/);
  assert.match(harness, /selectOption\(stage\.id\)/);
  assert.match(harness, /data-studio-shell/);
  assert.match(harness, /report\.error/);
  assert.doesNotMatch(harness, /textContent\?\.replace\(\/\\s\+\/g/);
});
