import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function harness(write = () => {}) {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function callBackend("), source.indexOf("function assertTrustedSender("));
  const pending = new Map();
  const timers = new Map();
  let timerSeq = 0;
  const call = vm.runInNewContext(`${body}; callBackend`, {
    backend: { stdin: { write } }, rpcSeq: 0, rpcWait: pending,
    setTimeout: (callback, delay) => { const id = ++timerSeq; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  return { call, pending, timers };
}

test("a cold native render can finish after five minutes without losing its result", async () => {
  const { call, pending, timers } = harness();
  const result = call("image.generatePrepared", { token: "one-use" });
  for (const timer of timers.values()) if (timer.delay <= 300_000) timer.callback();
  assert.equal(pending.size, 1);
  assert.equal([...timers.values()][0].delay, 35 * 60_000);
  pending.get(1).resolve({ receiptId: "saved-receipt" });
  pending.delete(1);
  assert.deepEqual(await result, { receiptId: "saved-receipt" });
  assert.equal(timers.size, 0);
});

test("ordinary backend calls retain their bounded timeout", async () => {
  const { call, pending, timers } = harness();
  const result = call("catalog.get", {});
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 300_000);
  timer.callback();
  await assert.rejects(result, /Desktop backend timed out/);
  assert.equal(pending.size, 0);
});

test("a dead backend pipe releases the pending request and timer immediately", async () => {
  const { call, pending, timers } = harness((_data, callback) => callback(new Error("broken pipe")));
  await assert.rejects(call("image.generatePrepared", {}), /broken pipe/);
  assert.equal(pending.size, 0);
  assert.equal(timers.size, 0);
});
