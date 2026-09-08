import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { livePackagedUatPassed } from "./pre-audit-evidence.mjs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("GREEN requires successful live packaged provider and artifact evidence", () => {
  assert.equal(livePackagedUatPassed({ ok: false, skipped: true }), false);
  assert.equal(livePackagedUatPassed({ ok: true, offlineHonest: true }), false);
  const live = { ok: true, skipped: false, packaged: true, onlineVerified: true, actualProviderCalls: 8,
    researchGenerated: true, screenplayGenerated: true, qaGenerated: true, assetsExtracted: true,
    noSilentFallback: true, network: { verified: true, cloud: 0, web: 0, comfy: 0, port8188: 0 } };
  assert.equal(livePackagedUatPassed(live), true);
  for (const key of ["packaged", "onlineVerified", "researchGenerated", "screenplayGenerated", "qaGenerated", "assetsExtracted", "noSilentFallback"]) {
    assert.equal(livePackagedUatPassed({ ...live, [key]: false }), false, key);
  }
  assert.equal(livePackagedUatPassed({ ...live, actualProviderCalls: 0 }), false);
  assert.equal(livePackagedUatPassed({ ...live, network: { ...live.network, verified: false } }), false);
  assert.equal(livePackagedUatPassed({ ...live, network: { ...live.network, web: 1 } }), false);
});

test("Intake keeps optional fields inside a closed disclosure and the idea/action/review outside", () => {
  const file = ts.createSourceFile("stage-views.tsx", source("src/components/studio/stage-views.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const intake = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "IntakeStage");
  assert.ok(intake);
  const disclosures = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "details") disclosures.push(node);
    ts.forEachChild(node, visit);
  };
  visit(intake);
  assert.equal(disclosures.length, 1);
  const details = disclosures[0];
  assert.equal(details.openingElement.attributes.properties.some((attr) => attr.name?.getText(file) === "open"), false);
  const optional = details.getText(file);
  for (const field of ["Source mode", "Title", "Logline", "Premise", "Treatment / Outline", "Existing screenplay", "Source material", "Source passages / references", "Genre", "Runtime (min)", "Tone", "Director notes"]) {
    assert.ok(optional.includes(field), `${field} must remain inside Optional details`);
  }
  const primary = intake.getText(file).replace(optional, "");
  assert.match(optional, />Optional details<\/summary>/);
  assert.match(primary, /What are we making\?/);
  assert.match(primary, /Build Movie Plan/);
  assert.match(primary, /Review and approve every production phase/);
  assert.doesNotMatch(primary, /<Field|<Label>(?:Logline|Premise|Director notes)/);
  assert.doesNotMatch(optional, /Build Movie Plan|What are we making\?/);
});

test("New Picture opens Intake without a mandatory title or creation form", () => {
  const home = source("src/components/studio/home.tsx");
  assert.match(home, /onNew=\{\(\) => newPicture\(makePictureIntake\(\)\)\}/);
  assert.doesNotMatch(home, /PictureIntakeForm|setIntakeOpen/);
});

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
  const advanced = source("src/components/studio/advanced-departments.tsx");
  const harness = source("scripts/desktop-stage-visual.mjs");
  assert.match(rail, /aria-label="Pipeline stage"/);
  assert.match(rail, /Advanced Departments/);
  assert.match(rail, /AdvancedDepartmentsRail/);
  assert.doesNotMatch(rail, /grid-cols-\[repeat\(13/);
  assert.match(advanced, /Return to Default Mode/);
  assert.match(advanced, /aria-current=\{current \? "step"/);
  assert.match(harness, /selectStudioStage/);
  assert.match(harness, /data-studio-shell/);
  assert.match(harness, /report\.error/);
  assert.doesNotMatch(harness, /textContent\?\.replace\(\/\\s\+\/g/);
});
