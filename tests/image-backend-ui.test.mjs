import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workspace = fs.readFileSync(fileURLToPath(new URL("../client/src/components/CreativeWorkspace.tsx", import.meta.url)), "utf8");
const store = fs.readFileSync(fileURLToPath(new URL("../client/src/store.ts", import.meta.url)), "utf8");
const picker = fs.readFileSync(fileURLToPath(new URL("../client/src/components/AssetReferencePicker.tsx", import.meta.url)), "utf8");

const h3Panel = workspace.match(/className=\{`h3-mini-panel[\s\S]*?<div className="timeline-actions"/)?.[0] || "";
const h3Picker = workspace.match(/h3ReferencePickerOpen[\s\S]*?<AssetReferencePicker[\s\S]*?\/>/)?.[0] || "";
const h3Notes = picker.match(/sourceRoute === "\/edit" \? "([^"]+)"/)?.[1] || "";

test("director does not default MiniMax H3 into first_frame as a stills painter", () => {
  assert.match(store, /h3Mode:\s*"t2v",/);
  assert.doesNotMatch(store, /h3Mode:\s*"first_frame",/);
});

test("storyboard still generate labels are Krea2/Klein2, not MiniMax", () => {
  const generateFrame = store.match(/generateStoryboardFrame: async[\s\S]*?finally \{/)?.[0] || "";
  assert.match(generateFrame, /Queued Krea2\/Klein2 still/);
  assert.doesNotMatch(generateFrame, /MiniMax/);
  assert.doesNotMatch(generateFrame, /H3/);
});

test("H3 mini-panel is video render, not first-frame still generation", () => {
  assert.match(h3Panel, /h3-mini-panel/);
  assert.match(h3Panel, /MINIMAX H3 VIDEO/);
  assert.match(h3Panel, /Video render only/);
  assert.match(h3Panel, /First-frame stills come from Assets\/Storyboard \(Krea2 or Klein2\)/);
  assert.match(h3Panel, /Queue H3 Video/);
  assert.doesNotMatch(h3Panel, /Render Selected with H3/);
  assert.doesNotMatch(h3Panel, /className="button primary"/);
  assert.doesNotMatch(h3Panel, /generates? the image/i);
  assert.doesNotMatch(h3Panel, /image generation/i);
  assert.doesNotMatch(h3Panel, /create first frames?/i);
});

test("H3 is not advertised as the way to create first-frame stills", () => {
  assert.doesNotMatch(workspace, /Render Selected with H3/);
  assert.doesNotMatch(workspace, /Add H3 image references/);
  assert.doesNotMatch(workspace, /MINIMAX H3 LOCAL/);
  assert.match(workspace, /First-frame stills come from Assets\/Storyboard \(Krea2 or Klein2\)/);
  assert.match(h3Picker, /Condition H3 video with existing stills/);
  assert.match(h3Picker, /Krea2 or Klein2/);
  assert.doesNotMatch(h3Picker, /image generation/i);
  assert.doesNotMatch(h3Notes, /image generation/i);
  assert.match(h3Notes, /condition MiniMax H3 video from existing stills/);
  assert.doesNotMatch(h3Notes, /generates? (the )?image/i);
});

test("LTX and H3 video render actions remain wired", () => {
  assert.match(workspace, /store\.renderSelection\(selectedClip\.id\)/);
  assert.match(workspace, />Render Selection</);
  assert.match(workspace, /store\.renderDirty\(selectedClip\.id\)/);
  assert.match(workspace, />Render Dirty</);
  assert.match(workspace, /queueH3Selection/);
  assert.match(store, /renderH3Selection:/);
  assert.match(store, /\/render-h3/);
});
