import assert from "node:assert/strict";
import { test } from "node:test";
import { openReferenceWindow, openDirectorWorkflowWindow, referenceWindowOptions, referenceWindowTarget } from "./reference-window.mjs";

test("reference windows allow only the Director instance and named official documentation origins", () => {
  for (const url of ["http://127.0.0.1:8190/", "https://docs.comfy.org/tutorials/audio", "https://huggingface.co/Comfy-Org", "https://github.com/WhatDreamsCost/WhatDreamsCost-ComfyUI"]) assert.ok(referenceWindowTarget(url));
  for (const url of ["http://127.0.0.1:18731/", "http://127.0.0.1:1234/", "http://localhost:8190/", "file:///D:/AI/Models/a", "javascript:alert(1)", "https://github.com.evil.test/", "https://user:password@github.com/", "http://github.com/", "https://huggingface.co:8443/"]) assert.equal(referenceWindowTarget(url), null, url);
});

test("approved Director window loads the exact graph without submitting from page JavaScript", async () => {
  const calls = [];
  class FakeWindow {
    webContents = {
      on() {}, setWindowOpenHandler() {},
      session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } },
      async executeJavaScript(script) { calls.push(script); return true; },
    };
    async loadURL(url) { calls.push(url); }
    focus() { calls.push("focused"); }
  }
  const workflow = { nodes: [{ id: 1, text: "An exact 'reviewed' prompt\nwith quotes" }] };
  assert.equal(await openDirectorWorkflowWindow({ BrowserWindow: FakeWindow, workflow }), true);
  assert.equal(calls[0], "http://127.0.0.1:8190");
  assert.ok(calls[1].includes(`loadGraphData(${JSON.stringify(workflow)})`));
  assert.doesNotMatch(calls[1], /queuePrompt|fetch\(|\/prompt/);
  assert.equal(calls[2], "focused");
});

test("reference windows have an isolated sandbox without a studio preload or Node integration", async () => {
  const target = referenceWindowTarget("http://127.0.0.1:8190/");
  const options = referenceWindowOptions(null, target);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.nodeIntegrationInSubFrames, false);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.webviewTag, false);
  assert.equal(options.webPreferences.preload, undefined);
  assert.ok(options.webPreferences.partition.startsWith("premiere316-reference-"));
  const events = new Map();
  const requests = [];
  let openHandler;
  let permissionCheck;
  class FakeWindow {
    webContents = {
      on: (name, handler) => events.set(name, handler),
      setWindowOpenHandler: (handler) => { openHandler = handler; },
      session: {
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: (handler) => { permissionCheck = handler; },
        webRequest: { onBeforeRequest: () => {} },
      },
    };
    async loadURL(url) { requests.push(url); }
  }
  assert.equal(openReferenceWindow({ BrowserWindow: FakeWindow, url: target.url }), true);
  assert.equal(permissionCheck(), false);
  let prevented = false;
  events.get("will-navigate")({ preventDefault: () => { prevented = true; } }, "http://127.0.0.1:18731/");
  assert.equal(prevented, true);
  assert.deepEqual(openHandler({ url: "https://github.com/" }), { action: "deny" });
  assert.equal(requests.length, 1, "Director content must not navigate to remote sites or open privileged windows.");
  openHandler({ url: "http://127.0.0.1:8190/?workflow=scene" });
  assert.equal(requests.length, 2);
});
