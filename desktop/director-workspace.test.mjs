import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createDirectorWorkspace } from "./director-workspace.mjs";

const toolbarPath = new URL("./director-workspace.html", import.meta.url).pathname;
const toolbarPreloadPath = new URL("./director-workspace-preload.cjs", import.meta.url).pathname;

function workflow(scene, image = false) {
  return { nodes: [{ id: scene, type: "LTXDirector", properties: { timeline_data: JSON.stringify({ global_prompt: `Scene ${scene}`, segments: [{ id: `segment-${scene}`, prompt: `Exact ${scene} \"quoted\"\nlines`, ...(image ? { imageFile: `${scene}.png` } : {}) }] }) } }] };
}

function harness({ execute, load } = {}) {
  const views = [];
  const parent = new EventEmitter();
  const ipcMain = new EventEmitter();
  const children = [];
  let parentDestroyed = false;
  let parentFocused = 0;
  let size = [1440, 900];
  parent.isDestroyed = () => parentDestroyed;
  parent.getContentSize = () => size;
  parent.webContents = { focus: () => { parentFocused += 1; } };
  parent.contentView = {
    addChildView: (view) => { assert.ok(!children.includes(view)); children.push(view); },
    removeChildView: (view) => { const index = children.indexOf(view); assert.ok(index >= 0); children.splice(index, 1); },
  };
  class WebContentsView {
    constructor(options) {
      this.options = options;
      this.bounds = null;
      const wc = new EventEmitter();
      let destroyed = false;
      wc.mainFrame = {};
      wc.urls = [];
      wc.files = [];
      wc.scripts = [];
      wc.messages = [];
      wc.focused = 0;
      wc.closed = 0;
      wc.isDestroyed = () => destroyed;
      wc.close = () => { destroyed = true; wc.closed += 1; wc.emit("destroyed"); };
      wc.focus = () => { wc.focused += 1; };
      wc.send = (...args) => wc.messages.push(args);
      wc.loadURL = async (url) => { wc.urls.push(url); await load?.(url); };
      wc.loadFile = async (path) => { wc.files.push(path); };
      wc.executeJavaScript = async (script) => { wc.scripts.push(script); return execute ? execute(script) : true; };
      wc.setWindowOpenHandler = (handler) => { wc.openHandler = handler; };
      wc.session = {
        setPermissionRequestHandler: (handler) => { wc.permissionRequest = handler; },
        setPermissionCheckHandler: (handler) => { wc.permissionCheck = handler; },
        webRequest: { onBeforeRequest: (...args) => { wc.beforeRequest = args.at(-1); } },
      };
      this.webContents = wc;
      views.push(this);
    }
    setBounds(bounds) { this.bounds = bounds; }
  }
  const workspace = createDirectorWorkspace({ WebContentsView, parent, toolbarPath, toolbarPreloadPath, ipcMain });
  return { workspace, views, parent, ipcMain, children, focused: () => parentFocused, resize: (next) => { size = next; parent.emit("resize"); }, destroyParent: () => { parentDestroyed = true; parent.emit("closed"); } };
}

test("different scenes load exact snapshots consecutively into one embedded editor", async () => {
  const h = harness();
  try {
    const first = workflow("one");
    const second = workflow("two");
    assert.equal(await h.workspace.open(first, { sceneId: "Scene one", pictureId: "picture-A" }), true);
    assert.equal(await h.workspace.open(second, { sceneId: "Scene two", pictureId: "picture-A" }), true);
    assert.equal(h.views.length, 2, "one editor and its toolbar, with no separate window");
    const [editor, toolbar] = h.views;
    assert.equal(editor.webContents.urls.length, 1, "scene changes reuse the same Comfy page");
    assert.equal(toolbar.webContents.files.length, 1);
    assert.equal(editor.webContents.scripts.length, 2);
    assert.ok(editor.webContents.scripts[0].includes(`const workflow = ${JSON.stringify(first)}`));
    assert.ok(editor.webContents.scripts[1].includes(`const workflow = ${JSON.stringify(second)}`));
    assert.deepEqual(h.children, h.views);
    assert.equal(toolbar.webContents.messages.at(-1)[1].sceneId, "Scene two");
    assert.equal(toolbar.webContents.messages.at(-1)[1].pictureId, "picture-A");
    assert.doesNotMatch(editor.webContents.scripts.join("\n"), /queuePrompt|fetch\(|\/prompt/);
  } finally { h.workspace.dispose(); }
});

test("back and show preserve the loaded workflow, and resize reserves the toolbar", async () => {
  const h = harness();
  try {
    assert.equal(await h.workspace.show(), false);
    await h.workspace.open(workflow("one"));
    const [editor, toolbar] = h.views;
    assert.deepEqual(toolbar.bounds, { x: 0, y: 0, width: 1440, height: 48 });
    assert.deepEqual(editor.bounds, { x: 0, y: 48, width: 1440, height: 852 });
    h.workspace.close();
    assert.equal(h.children.length, 0);
    assert.equal(h.focused(), 1);
    h.resize([1080, 720]);
    assert.equal(await h.workspace.show(), true);
    assert.deepEqual(editor.bounds, { x: 0, y: 48, width: 1080, height: 672 });
    assert.equal(editor.webContents.scripts.length, 1);
    assert.equal(editor.webContents.urls.length, 1);
    assert.equal(editor.webContents.closed, 0);
  } finally { h.workspace.dispose(); }
});

test("Comfy content is isolated, has no preload, and cannot navigate or acquire permissions", async () => {
  const h = harness();
  try {
    await h.workspace.open(workflow("one"));
    const [editor, toolbar] = h.views;
    for (const view of h.views) {
      const preferences = view.options.webPreferences;
      assert.equal(preferences.sandbox, true);
      assert.equal(preferences.contextIsolation, true);
      assert.equal(preferences.nodeIntegration, false);
      assert.equal(preferences.nodeIntegrationInSubFrames, false);
      assert.equal(preferences.webSecurity, true);
      assert.equal(preferences.webviewTag, false);
      assert.ok(!preferences.partition.startsWith("persist:"));
      assert.equal(view.webContents.permissionCheck(), false);
      let permission;
      view.webContents.permissionRequest(null, "media", (allowed) => { permission = allowed; });
      assert.equal(permission, false);
      assert.deepEqual(view.webContents.openHandler({ url: "http://127.0.0.1:8190/" }), { action: "deny" });
    }
    assert.equal(editor.options.webPreferences.preload, undefined);
    assert.equal(toolbar.options.webPreferences.preload, toolbarPreloadPath);
    assert.notEqual(editor.options.webPreferences.partition, toolbar.options.webPreferences.partition);
    for (const url of ["file:///C:/secrets.txt", "http://127.0.0.1:18731/", "https://example.com/", "http://user:pass@127.0.0.1:8190/"]) {
      let prevented = false;
      editor.webContents.emit("will-navigate", { preventDefault: () => { prevented = true; } }, url);
      assert.equal(prevented, true, url);
    }
    let prevented = false;
    editor.webContents.emit("will-navigate", { preventDefault: () => { prevented = true; } }, "http://127.0.0.1:8190/?scene=one");
    assert.equal(prevented, false);
    let blocked;
    editor.webContents.beforeRequest({ url: "file:///C:/secret.txt" }, (result) => { blocked = result.cancel; });
    assert.equal(blocked, true);
  } finally { h.workspace.dispose(); }
});

test("only the exact toolbar main frame can close the editor; disposal cleans owned resources", async () => {
  const h = harness();
  await h.workspace.open(workflow("one"));
  const [editor, toolbar] = h.views;
  const channel = h.ipcMain.eventNames()[0];
  h.ipcMain.emit(channel, { sender: editor.webContents, senderFrame: editor.webContents.mainFrame });
  assert.equal(h.children.length, 2);
  h.ipcMain.emit(channel, { sender: toolbar.webContents, senderFrame: {} });
  assert.equal(h.children.length, 2);
  h.ipcMain.emit(channel, { sender: toolbar.webContents, senderFrame: toolbar.webContents.mainFrame });
  assert.equal(h.children.length, 0);
  await h.workspace.show();
  h.workspace.dispose();
  h.workspace.dispose();
  assert.equal(h.children.length, 0);
  assert.equal(h.parent.listenerCount("resize"), 0);
  assert.equal(h.parent.listenerCount("closed"), 0);
  assert.equal(h.ipcMain.listenerCount(channel), 0);
  for (const view of h.views) {
    assert.equal(view.webContents.closed, 1);
    assert.equal(view.webContents.eventNames().length, 0);
    assert.equal(view.webContents.permissionRequest, null);
  }
  assert.equal(h.parent.isDestroyed(), false);
  assert.equal(await h.workspace.show(), false);
});

test("loading failures reveal Premiere without destroying its renderer", async () => {
  const h = harness({ execute: () => { throw new Error("Selected scene failed to load"); } });
  try {
    await assert.rejects(h.workspace.open(workflow("one")), /Selected scene failed/);
    assert.equal(h.children.length, 0);
    assert.equal(h.parent.isDestroyed(), false);
    assert.equal(await h.workspace.show(), false);
  } finally { h.workspace.dispose(); }
});

test("opening snapshots input and later queued selection wins without loading a stale scene", async () => {
  const h = harness();
  try {
    const first = h.workspace.open(workflow("one"));
    const selected = workflow("two");
    const expected = JSON.stringify(selected);
    const second = h.workspace.open(selected, { sceneId: "two" });
    selected.nodes[0].properties.timeline_data = "mutated";
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.equal(h.views[0].webContents.scripts.length, 1);
    assert.ok(h.views[0].webContents.scripts[0].includes(`const workflow = ${expected}`));
  } finally { h.workspace.dispose(); }
});

test("Back during workflow loading resolves false, and a late completion cannot replace a newer scene", async () => {
  let began;
  let finishOld;
  let first = true;
  const loading = new Promise((resolve) => { began = resolve; });
  const h = harness({ execute: (script) => {
    if (!script.includes("const workflow =")) return true;
    if (!first) return true;
    first = false;
    began();
    return new Promise((resolve) => { finishOld = resolve; });
  } });
  try {
    const opening = h.workspace.open(workflow("cancelled"), { sceneId: "cancelled" });
    await loading;
    h.workspace.close();
    assert.equal(await opening, false, "an approved-run caller must not submit after Back");
    assert.equal(await h.workspace.show(), false);
    assert.equal(h.children.length, 0);
    assert.equal(await h.workspace.open(workflow("new-scene"), { sceneId: "new-scene" }), true);
    assert.equal(h.views[0].webContents.urls.length, 2, "a fresh document terminates old pending graph work");
    finishOld(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.views[1].webContents.messages.at(-1)[1].sceneId, "new-scene");
    assert.equal(h.children.length, 2);
    assert.ok(h.views[0].webContents.scripts.some((script) => !script.includes("const workflow =") && script.includes("Math.max")));
  } finally { h.workspace.dispose(); }
});

test("a cancelled readiness loop never reaches loadGraphData", async () => {
  let script;
  const h = harness({ execute: (value) => { script = value; return true; } });
  try {
    await h.workspace.open(workflow("waiting"));
    const waiting = [];
    const window = {};
    let time = 0;
    let loads = 0;
    const running = runInNewContext(script, {
      window, document: { getElementById: () => null }, Date: { now: () => time },
      setTimeout: (callback) => { waiting.push(callback); },
    });
    const key = Object.keys(window).find((value) => value.startsWith("__premiere316DirectorLoad_"));
    window[key] += 1;
    window.app = { graph: { _nodes: [] }, loadGraphData: async () => { loads += 1; } };
    time += 100;
    waiting.shift()();
    await assert.rejects(running, /scene changed or was closed/);
    assert.equal(loads, 0);
  } finally { h.workspace.dispose(); }
});

function executeGraphScript(script, { imageReady = true, replaceTimeline = false, stringifyIds = false } = {}) {
  const graph = { _nodes: [] };
  const app = {
    graph,
    async loadGraphData(data) {
      graph._nodes = stringifyIds ? data.nodes.map(node => ({ ...node, id: String(node.id) })) : data.nodes;
      const director = graph._nodes[0];
      if (replaceTimeline) director.properties.timeline_data = JSON.stringify({ segments: [] });
      const segments = JSON.parse(director.properties.timeline_data).segments;
      if (segments.some((segment) => segment.imageFile || segment.imageB64)) {
        director._timelineEditor = { timeline: { segments: segments.map((segment) => ({ ...segment, imgObj: { complete: imageReady, naturalWidth: imageReady ? 1920 : 0 } })) } };
      }
    },
  };
  let time = 0;
  return runInNewContext(script, {
    window: { app }, document: { getElementById: () => null },
    Date: { now: () => time }, setTimeout: (fn) => { time += 1000; fn(); },
  });
}

test("image-free scene becomes ready without a timeline image editor", async () => {
  const h = harness({ execute: (script) => executeGraphScript(script) });
  try { assert.equal(await h.workspace.open(workflow("no-images")), true); }
  finally { h.workspace.dispose(); }
});

test("numeric source IDs still match after ComfyUI normalizes loaded node IDs to strings", async () => {
  const h = harness({ execute: script => executeGraphScript(script, { stringifyIds: true }) });
  try {
    assert.equal(await h.workspace.open(workflow(135, true), { sceneId: "PS-S01" }), true);
    assert.equal(h.children.length, 2);
    assert.equal(h.views[1].webContents.messages.at(-1)[1].status, "");
  } finally { h.workspace.dispose(); }
});

test("images must render and a different loaded scene is rejected", async () => {
  const ready = harness({ execute: (script) => executeGraphScript(script) });
  const broken = harness({ execute: (script) => executeGraphScript(script, { imageReady: false }) });
  const wrong = harness({ execute: (script) => executeGraphScript(script, { replaceTimeline: true }) });
  try {
    assert.equal(await ready.workspace.open(workflow("images", true)), true);
    await assert.rejects(broken.workspace.open(workflow("images", true)), /Starting images could not/);
    await assert.rejects(wrong.workspace.open(workflow("wrong")), /different scene timeline/);
  } finally { ready.workspace.dispose(); broken.workspace.dispose(); wrong.workspace.dispose(); }
});

test("parent disposal cancels an in-flight load and closes both child webContents", async () => {
  let began;
  const loading = new Promise((resolve) => { began = resolve; });
  const h = harness({ load: () => { began(); return new Promise(() => {}); } });
  const opening = h.workspace.open(workflow("one"));
  await loading;
  h.destroyParent();
  await assert.rejects(opening, /workspace was closed/);
  assert.equal(h.views[0].webContents.closed, 1);
  assert.equal(h.views[1].webContents.closed, 1);
  assert.equal(h.parent.listenerCount("resize"), 0);
});

test("toolbar exposes only close and contains no remote scripts or workflow execution", () => {
  const preload = readFileSync(new URL("./director-workspace-preload.cjs", import.meta.url), "utf8");
  const html = readFileSync(new URL("./director-workspace.html", import.meta.url), "utf8");
  assert.match(preload, /exposeInMainWorld\("directorWorkspace", Object.freeze\(\{ close \}\)\)/);
  assert.doesNotMatch(preload, /\.invoke\(|\.sendSync\(|fetch\(|queuePrompt/);
  assert.match(html, /Back to Premiere/);
  assert.match(html, /script-src 'none'/);
  assert.doesNotMatch(html, /<script|https?:\/\//);
});
