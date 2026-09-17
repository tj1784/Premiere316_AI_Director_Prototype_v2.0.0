import assert from "node:assert/strict";
import { test } from "node:test";
import { createDirectorProgress } from "./director-progress.mjs";

const ID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
function fixture(context, overrides = {}) {
  const requests = [], sockets = [];
  let clock = 1000;
  let job = { id: ID, status: "in_progress" };
  let failure = null;
  class Socket {
    events = new Map();
    closeCount = 0;
    constructor(url) { this.url = url; sockets.push(this); }
    addEventListener(name, callback) { const list = this.events.get(name) ?? []; list.push(callback); this.events.set(name, list); }
    emit(name, event = {}) { for (const callback of this.events.get(name) ?? []) callback(event); }
    message(type, data) { this.emit("message", { data: JSON.stringify({ type, data }) }); }
    close() { this.closeCount++; this.emit("close"); }
  }
  const monitor = createDirectorProgress({
    WebSocketImpl: Socket, now: () => clock,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (failure) throw failure;
      if (url.includes("/api/jobs/")) return Response.json(job);
      if (url.endsWith("/queue")) return Response.json({ queue_pending: [], queue_running: [[0, ID,
        { 1: { class_type: "VAEDecode" }, 2: { class_type: "SamplerCustomAdvanced" }, 3: { class_type: "VHS_VideoCombine" } },
        { client_id: `premiere316-${ID}` }, []]] });
      throw new Error(`Unexpected URL ${url}`);
    },
    ...overrides,
  });
  context.after(() => monitor.stop());
  return { monitor, requests, sockets, setJob: next => { job = next; }, setClock: next => { clock = next; }, fail: error => { failure = error; } };
}

test("job API supplies terminal state and timestamps without opening a socket", async context => {
  const { monitor, requests, sockets, setJob } = fixture(context);
  setJob({ id: ID, status: "cancelled", execution_start_time: 100, execution_end_time: 900 });
  const result = await monitor.getProgress(ID);
  assert.equal(result.status, "cancelled");
  assert.equal(result.executionStartTime, 100);
  assert.equal(result.lastUpdated, 900);
  assert.equal(result.value, null);
  assert.equal(result.nodeId, null);
  assert.equal(requests.length, 1);
  assert.equal(sockets.length, 0);
});

test("already-running jobs reconnect to their own client and recover a node without invented counters", async context => {
  const { monitor, requests, sockets } = fixture(context);
  const initial = await monitor.getProgress(ID);
  assert.equal(initial.status, "running");
  assert.equal(initial.connection, "connecting");
  assert.equal(initial.nodeId, null);
  const socket = sockets[0];
  assert.equal(socket.url, `ws://127.0.0.1:8190/ws?clientId=premiere316-${ID}`);
  socket.emit("open");
  socket.message("executing", { node: "1" });
  const current = await monitor.getProgress(ID);
  assert.equal(current.nodeId, "1");
  assert.equal(current.nodeType, "VAEDecode");
  assert.equal(current.stage, "Decoding video frames");
  assert.equal(current.value, null);
  assert.equal(current.max, null);
  assert.equal(current.connection, "connected");
  assert.equal(requests.filter(request => request.url.endsWith("/queue")).length, 1);
  assert.ok(requests.every(request => request.options.method === "GET" && request.options.redirect === "error"));
});

test("only matching job events change measured node progress and a new node resets it", async context => {
  const { monitor, sockets, setClock } = fixture(context);
  await monitor.getProgress(ID);
  const socket = sockets[0]; socket.emit("open");
  socket.message("progress", { prompt_id: ID, node: "2", value: 15, max: 30 });
  let current = await monitor.getProgress(ID);
  assert.equal(current.stage, "Sampling");
  assert.equal(current.value, 15); assert.equal(current.max, 30);
  socket.message("progress", { prompt_id: OTHER, node: "3", value: 99, max: 100 });
  socket.emit("message", { data: new ArrayBuffer(20) });
  socket.emit("message", { data: "malformed" });
  setClock(2000);
  current = await monitor.getProgress(ID);
  assert.equal(current.value, 15); assert.equal(current.lastUpdated, 1000);
  socket.message("executing", { prompt_id: ID, node: "1" });
  current = await monitor.getProgress(ID);
  assert.equal(current.stage, "Decoding video frames");
  assert.equal(current.value, null); assert.equal(current.max, null);
  assert.equal(current.lastUpdated, 2000);
});

test("a job starting during the websocket handshake accepts the reconnect node snapshot", async context => {
  const { monitor, sockets, setJob } = fixture(context);
  setJob({ id: ID, status: "pending" });
  assert.equal((await monitor.getProgress(ID)).status, "queued");
  sockets[0].emit("open"); sockets[0].message("executing", { node: "1" });
  setJob({ id: ID, status: "in_progress" });
  const current = await monitor.getProgress(ID);
  assert.equal(current.status, "running");
  assert.equal(current.stage, "Decoding video frames");
  assert.equal(current.value, null);
});

test("modern progress_state handles dynamic node identity and clears finished sampling totals", async context => {
  const { monitor, sockets } = fixture(context);
  await monitor.getProgress(ID); const socket = sockets[0]; socket.emit("open");
  socket.message("progress_state", { prompt_id: ID, nodes: { "2:0": { node_id: "2:0", real_node_id: "2", state: "running", value: 0, max: 1 } } });
  let current = await monitor.getProgress(ID);
  assert.equal(current.stage, "Sampling"); assert.equal(current.value, null);
  socket.message("progress_state", { prompt_id: ID, nodes: { "2:0": { node_id: "2:0", real_node_id: "2", state: "running", value: 8, max: 8 } } });
  current = await monitor.getProgress(ID);
  assert.equal(current.value, 8); assert.equal(current.max, 8);
  socket.message("progress_state", { prompt_id: ID, nodes: { "2:0": { state: "finished", value: 8, max: 8 } } });
  current = await monitor.getProgress(ID);
  assert.equal(current.status, "running"); assert.equal(current.value, null); assert.equal(current.stage, null);
});

test("disconnection preserves last observed data until reconnect, then clears stale counters", async context => {
  const { monitor, sockets, setClock } = fixture(context);
  await monitor.getProgress(ID); const first = sockets[0]; first.emit("open");
  first.message("progress", { prompt_id: ID, node: "2", value: 3, max: 30 });
  first.emit("close");
  let current = await monitor.getProgress(ID);
  assert.equal(current.connection, "disconnected"); assert.equal(current.value, 3);
  assert.equal(current.lastUpdated, 1000); assert.equal(sockets.length, 1);
  setClock(2100); await monitor.getProgress(ID);
  assert.equal(sockets.length, 2);
  sockets[1].emit("open"); sockets[1].message("executing", { node: "1" });
  first.message("progress", { prompt_id: ID, node: "2", value: 25, max: 30 });
  current = await monitor.getProgress(ID);
  assert.equal(current.stage, "Decoding video frames"); assert.equal(current.value, null);
});

test("terminal API state closes a monitor and does not expose stale node totals", async context => {
  const { monitor, sockets, setJob } = fixture(context);
  await monitor.getProgress(ID); sockets[0].emit("open");
  sockets[0].message("progress", { prompt_id: ID, node: "2", value: 30, max: 30 });
  setJob({ id: ID, status: "completed", execution_end_time: 1200 });
  const current = await monitor.getProgress(ID);
  assert.equal(current.status, "completed"); assert.equal(current.lastUpdated, 1200);
  assert.equal(current.value, null); assert.equal(current.nodeId, null);
  assert.equal(sockets[0].closeCount, 1);
});

test("unavailable job API reports the error without making up fresh progress", async context => {
  const { monitor, fail } = fixture(context);
  await monitor.getProgress(ID);
  fail(new Error("Connection refused"));
  const current = await monitor.getProgress(ID);
  assert.equal(current.status, "running");
  assert.equal(current.observedAt, 1000);
  assert.equal(current.lastUpdated, null);
  assert.match(current.error, /Connection refused/);
});

test("monitor never replaces another application's websocket client", async context => {
  const { monitor, sockets } = fixture(context, { fetchImpl: async url => Response.json(url.endsWith("/queue")
    ? { queue_running: [[0, ID, {}, { client_id: "browser-user-session" }]], queue_pending: [] }
    : { id: ID, status: "in_progress" }) });
  const result = await monitor.getProgress(ID);
  assert.equal(result.status, "running"); assert.equal(result.connection, "unavailable");
  assert.equal(sockets.length, 0);
});

test("invalid IDs and stopped monitors perform no requests, and simultaneous polls are shared", async context => {
  const { monitor, requests, sockets } = fixture(context);
  assert.equal((await monitor.getProgress("../queue")).status, "unknown");
  assert.equal(requests.length, 0);
  await Promise.all([monitor.getProgress(ID), monitor.getProgress(ID)]);
  assert.equal(requests.length, 2); assert.equal(sockets.length, 1);
  monitor.stop(); const count = requests.length;
  await monitor.getProgress(ID);
  assert.equal(requests.length, count); assert.equal(sockets[0].closeCount, 1);
});

test("a pending HTTP request cannot create a websocket after shutdown", async context => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const { monitor, sockets } = fixture(context, { fetchImpl: () => response });
  const pending = monitor.getProgress(ID);
  monitor.stop(); finish(Response.json({ id: ID, status: "in_progress" }));
  await pending;
  assert.equal(sockets.length, 0);
});
