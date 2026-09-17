import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { createDirectorHost, DIRECTOR_LAUNCH_ARGS, DIRECTOR_PYTHON } from "./director-host.mjs";

const ready = () => ({ ok: true, json: async () => ({ system: { comfyui_version: "0.34.0" } }) });
const offline = () => { throw new TypeError("fetch failed", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) }); };
function setup(overrides = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  let killed = 0;
  child.kill = () => { killed += 1; };
  const spawned = [];
  const closed = [];
  let time = 0;
  let calls = 0;
  const host = createDirectorHost({
    fetchImpl: async () => { calls += 1; return calls === 1 ? offline() : ready(); },
    spawnImpl: (...args) => { spawned.push(args); return child; },
    existsImpl: () => true,
    logDirectory: "C:/Users/test/AppData/Premiere316/logs",
    mkdirImpl: () => {},
    openLogImpl: () => 42,
    closeLogImpl: (fd) => closed.push(fd),
    now: () => time,
    waitImpl: async (milliseconds) => { time += milliseconds; },
    ...overrides,
  });
  return { host, child, spawned, closed, killed: () => killed, elapsed: () => time };
}

describe("LTX Director service host", () => {
  it("reuses an existing healthy service without starting or stopping it", async () => {
    const test = setup({ fetchImpl: async () => ready() });
    await test.host.ensure();
    test.host.stop();
    assert.equal(test.spawned.length, 0);
    assert.equal(test.killed(), 0);
  });

  it("launches only the fixed runtime with hidden shell-free args and closes log descriptors", async () => {
    const test = setup();
    await test.host.ensure();
    const [executable, args, options] = test.spawned[0];
    assert.equal(executable, DIRECTOR_PYTHON);
    assert.deepEqual(args, [...DIRECTOR_LAUNCH_ARGS]);
    assert.equal(options.windowsHide, true);
    assert.equal(options.shell, false);
    assert.equal(options.detached, false);
    assert.ok(args.includes("--disable-auto-launch"));
    assert.ok(!args.some((arg) => /install|upgrade/.test(arg)));
    assert.deepEqual(test.closed, [42, 42]);
    test.host.stop();
    test.host.stop();
    assert.equal(test.killed(), 1);
  });

  it("deduplicates simultaneous startup requests", async () => {
    const test = setup();
    const first = test.host.ensure();
    const second = test.host.ensure();
    assert.equal(first, second);
    await Promise.all([first, second]);
    assert.equal(test.spawned.length, 1);
    test.host.stop();
  });

  it("waits for its existing owned process instead of spawning a second one on transient refusal", async () => {
    let calls = 0;
    const test = setup({ fetchImpl: async () => { calls += 1; return calls === 1 || calls === 3 ? offline() : ready(); } });
    await test.host.ensure();
    await test.host.ensure();
    assert.equal(test.spawned.length, 1);
    test.host.stop();
    assert.equal(test.killed(), 1);
  });

  it("does not launch when an occupied endpoint returns invalid health or times out", async () => {
    for (const fetchImpl of [
      async () => ({ ok: false, status: 503 }),
      async () => ({ ok: true, json: async () => ({ application: "other" }) }),
      async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); },
    ]) {
      const test = setup({ fetchImpl });
      await assert.rejects(test.host.ensure());
      assert.equal(test.spawned.length, 0);
    }
  });

  it("reports missing installations without any launch", async () => {
    const test = setup({ existsImpl: () => false });
    await assert.rejects(test.host.ensure(), /missing/);
    assert.equal(test.spawned.length, 0);
  });

  it("bounds readiness to 60 seconds and stops only its owned child", async () => {
    const test = setup({ fetchImpl: async () => offline(), readinessTimeoutMs: 120_000 });
    await assert.rejects(test.host.ensure(), /60 seconds/);
    assert.equal(test.elapsed(), 60_000);
    assert.equal(test.spawned.length, 1);
    assert.equal(test.killed(), 1);
  });

  it("detects child startup error and exit without killing unrelated processes", async () => {
    for (const event of ["error", "exit"]) {
      const test = setup();
      const startup = test.host.ensure();
      await Promise.resolve();
      await Promise.resolve();
      if (event === "error") test.child.emit("error", new Error("spawn failed"));
      else test.child.emit("exit", 1, null);
      await assert.rejects(startup, event === "error" ? /could not start/ : /exited/);
      test.host.stop();
      assert.equal(test.killed(), 0);
    }
  });

  it("cancels a pending startup before spawning when stop is called", async () => {
    let release;
    const test = setup({ fetchImpl: () => new Promise((_resolve, reject) => { release = () => { try { offline(); } catch (error) { reject(error); } }; }) });
    const startup = test.host.ensure();
    test.host.stop();
    release();
    await assert.rejects(startup, /cancelled/);
    assert.equal(test.spawned.length, 0);
  });
});
