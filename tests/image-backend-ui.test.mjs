import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const workspace = fs.readFileSync(fileURLToPath(new URL("../client/src/components/CreativeWorkspace.tsx", import.meta.url)), "utf8");
const store = fs.readFileSync(fileURLToPath(new URL("../client/src/store.ts", import.meta.url)), "utf8");
const picker = fs.readFileSync(fileURLToPath(new URL("../client/src/components/AssetReferencePicker.tsx", import.meta.url)), "utf8");

const h3Panel = workspace.match(/className=\{`h3-mini-panel[\s\S]*?<div className="timeline-actions"/)?.[0] || "";
const h3Picker = workspace.match(/h3ReferencePickerOpen[\s\S]*?<AssetReferencePicker[\s\S]*?\/>/)?.[0] || "";
const h3Notes = picker.match(/targetKind === "h3" \? "([^"]+)"/)?.[1] || "";
const h3Default = store.match(/h3Busy:\s*false,\s*h3Mode:\s*"[^"]+",/)?.[0] || "";

function loadPickerExports() {
  const compiled = ts.transpileModule(picker, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  }).outputText;
  const module = { exports: {} };
  const noop = () => undefined;
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === "react") return { default: {}, useEffect: noop, useMemo: noop, useRef: noop, useState: noop };
      if (specifier === "react/jsx-runtime") return { Fragment: Symbol("Fragment"), jsx: noop, jsxs: noop };
      if (specifier === "../store") return { assetUrl: noop };
      if (specifier === "../contextual-agency") return { openAssetAction: noop, useAssetActionStore: noop };
      throw new Error(`Unexpected picker dependency: ${specifier}`);
    }
  });
  return module.exports;
}

test("director does not default MiniMax H3 into first_frame as a stills painter", () => {
  assert.match(h3Default, /h3Mode:\s*"t2v"/);
  assert.doesNotMatch(h3Default, /h3Mode:\s*"first_frame"/);
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
  assert.match(h3Panel, /Video from first-frame still/);
  assert.match(h3Panel, /Video from last-frame still/);
  assert.match(h3Panel, /Video from first \+ last stills/);
  assert.doesNotMatch(h3Panel, />First Frame to Video</);
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
  assert.doesNotMatch(workspace, /MiniMax H3 image/i);
  assert.doesNotMatch(workspace, /selectedH3Mode\?\.label/);
  assert.match(workspace, /First-frame stills come from Assets\/Storyboard \(Krea2 or Klein2\)/);
  assert.match(workspace, /MiniMax H3 Video/);
  assert.match(h3Picker, /Condition H3 video with existing stills/);
  assert.match(h3Picker, /Krea2 or Klein2/);
  assert.doesNotMatch(h3Picker, /image generation/i);
  assert.doesNotMatch(h3Notes, /image generation/i);
  assert.match(h3Notes, /condition MiniMax H3 video from existing stills/);
  assert.doesNotMatch(h3Notes, /generates? (the )?image/i);
  assert.match(picker, /targetKind === "h3"/);
  assert.doesNotMatch(picker, /sourceRoute === "\/edit" \? "/);
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

test("reference picker exposes only the exact approved active visual version", () => {
  const { exactCurrentApprovedVisualVersion } = loadPickerExports();
  const project = { category: "feature", settings: {} };
  const asset = {
    activeVersion: 2,
    approvalCurrent: true,
    approval: { status: "approved", activeVersion: 2 },
    versions: [
      { v: 1, file: "historical.png" },
      { v: 2, file: "approved.png" },
      { v: 3, file: "newer-but-inactive.png" }
    ]
  };
  assert.equal(exactCurrentApprovedVisualVersion(project, asset).file, "approved.png");
  assert.equal(exactCurrentApprovedVisualVersion(project, { ...asset, approvalCurrent: false }), null);
  assert.equal(exactCurrentApprovedVisualVersion(project, {
    ...asset,
    approval: { status: "approved", activeVersion: 1 }
  }), null);
  assert.equal(exactCurrentApprovedVisualVersion(project, {
    ...asset,
    versions: [{ v: 2, file: "voice.wav" }]
  }), null);
});

test("reference picker has no historical-version or client-provenance escape hatch", () => {
  assert.doesNotMatch(picker, /versions\.at\s*\(/);
  assert.doesNotMatch(picker, /pinnedActiveAtImport/);
  assert.doesNotMatch(picker, /asset\.activeVersion\s*\|\|/);
  assert.doesNotMatch(picker, /lastResult\.version\s*\|\|/);
  assert.doesNotMatch(picker, /<select\s+value=\{reference\.assetVersion\}/);
  assert.doesNotMatch(picker, /· historical/);
  assert.match(picker, /Approved current · v\{version\}/);
});
