import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("preload progress is typed, strips the Electron event, and unsubscribes", () => {
  const listeners = new Map();
  let exposed;
  vm.runInNewContext(readFileSync(new URL("./preload.cjs", import.meta.url), "utf8"), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, api) => { exposed = api; } }, ipcRenderer: { on: (channel, callback) => listeners.set(channel, callback), removeListener: (channel, callback) => { if (listeners.get(channel) === callback) listeners.delete(channel); }, invoke: () => Promise.resolve() }, webUtils: {} }),
    process: { platform: "win32" },
  });
  const received = [];
  const stop = exposed.image.onProgress((event) => received.push(event));
  const listener = listeners.get("p316:image:progress");
  const progress = { pictureId: "picture", assetId: "asset", preparedAssetId: "prepared", message: "CPU text encoder loaded.", at: 123 };
  listener({ sender: "must not escape" }, progress);
  assert.deepEqual(JSON.parse(JSON.stringify(received)), [progress]);
  listener({}, { ...progress, message: "x".repeat(501) });
  listener({}, { ...progress, assetId: null });
  assert.equal(received.length, 1);
  stop();
  assert.equal(listeners.has("p316:image:progress"), false);
});

test("main forwards live notifications without consuming or resolving generation RPC", () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").split("function startBackend() {")[1];
  const callback = source.match(/rl\.on\("line", (\(line\) => \{[\s\S]*?)\);\r?\n  child\.stderr/)[1];
  const sent = [];
  const resolved = [];
  const rpcWait = new Map([["rpc-1", { resolve: (result) => resolved.push(result), reject: assert.fail }]]);
  const onLine = vm.runInNewContext(`(${callback})`, { rpcWait, URL, uiOrigin: "http://127.0.0.1:18731", channels: { imageProgress: "p316:image:progress" }, mainWindow: { isDestroyed: () => false, webContents: { isDestroyed: () => false, getURL: () => "http://127.0.0.1:18731/", send: (channel, event) => sent.push({ channel, event }) } } });
  const progress = { event: "imageProgress", pictureId: "picture", assetId: "asset", preparedAssetId: "prepared", message: "CPU text encoder loaded.", at: 123 };
  onLine(JSON.stringify(progress));
  assert.equal(sent.length, 1);
  assert.equal(rpcWait.size, 1);
  assert.deepEqual(resolved, []);
  onLine(JSON.stringify({ ...progress, id: "rpc-1" }));
  assert.equal(sent.length, 1);
  assert.equal(rpcWait.size, 1);
  onLine(JSON.stringify({ id: "rpc-1", ok: true, result: { ok: true, url: "media://image.png" } }));
  assert.equal(rpcWait.size, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(resolved)), [{ ok: true, url: "media://image.png" }]);
});
