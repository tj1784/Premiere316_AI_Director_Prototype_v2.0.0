import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProjectStorage, type ProjectStorageBackend, type ProjectStorageError } from "./project-storage.ts";

const KEY = "premiere316-v302-c";
function legacyStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function durableStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const backend: ProjectStorageBackend = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async (key) => { data.delete(key); },
  };
  return { data, backend };
}

describe("large project persistence", () => {
  it("migrates the exact existing payload and reloads from the durable backend", async () => {
    const raw = JSON.stringify({ state: { pictures: [{ id: "existing", screenplay: "scene" }] }, version: 0 });
    const legacy = legacyStorage({ [KEY]: raw });
    const durable = durableStorage();
    const storage = createProjectStorage({ backend: durable.backend, legacyStorage: legacy })!;
    assert.equal(await storage.getItem(KEY), raw);
    assert.equal(durable.data.get(KEY), raw);
    assert.equal(legacy.getItem(KEY), null);
    const reopened = createProjectStorage({ backend: durable.backend, legacyStorage: legacy })!;
    assert.equal(await reopened.getItem(KEY), raw);
  });

  it("retains the legacy copy until its durable commit completes", async () => {
    const legacy = legacyStorage({ [KEY]: "old project" });
    const durable = durableStorage();
    let finish!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    durable.backend.setItem = async (key, value) => {
      started();
      await new Promise<void>((resolve) => { finish = resolve; });
      durable.data.set(key, value);
    };
    const storage = createProjectStorage({ backend: durable.backend, legacyStorage: legacy })!;
    const reading = storage.getItem(KEY);
    await startedPromise;
    assert.equal(legacy.getItem(KEY), "old project");
    finish();
    assert.equal(await reading, "old project");
    assert.equal(legacy.getItem(KEY), null);
  });

  it("preserves legacy projects when migration fails and retries on the next write", async () => {
    const legacy = legacyStorage({ [KEY]: "existing" });
    const durable = durableStorage();
    const errors: ProjectStorageError[] = [];
    const write = durable.backend.setItem;
    durable.backend.setItem = async () => { throw new Error("disk unavailable"); };
    const storage = createProjectStorage({ backend: durable.backend, legacyStorage: legacy, onError: (error) => errors.push(error) })!;
    assert.equal(await storage.getItem(KEY), "existing");
    assert.equal(legacy.getItem(KEY), "existing");
    assert.equal(errors[0].operation, "write");
    durable.backend.setItem = write;
    await storage.setItem(KEY, "newer");
    assert.equal(durable.data.get(KEY), "newer");
    assert.equal(legacy.getItem(KEY), null);
  });

  it("serializes writes and reads without a stale write winning", async () => {
    const durable = durableStorage();
    const order: string[] = [];
    let finish!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    durable.backend.setItem = async (key, value) => {
      order.push(value);
      if (value === "first") {
        started();
        await new Promise<void>((resolve) => { finish = resolve; });
      }
      durable.data.set(key, value);
    };
    const storage = createProjectStorage({ backend: durable.backend, legacyStorage: null })!;
    const first = storage.setItem(KEY, "first");
    await startedPromise;
    const second = storage.setItem(KEY, "second");
    const read = storage.getItem(KEY);
    assert.deepEqual(order, ["first"]);
    finish();
    await Promise.all([first, second]);
    assert.equal(await read, "second");
    assert.deepEqual(order, ["first", "second"]);
  });

  it("stores payloads exceeding localStorage quota without writing to localStorage", async () => {
    const raw = "x".repeat(6 * 1024 * 1024);
    const durable = durableStorage();
    const legacy = legacyStorage();
    legacy.setItem = () => { throw new Error("localStorage quota"); };
    const storage = createProjectStorage({ backend: durable.backend, legacyStorage: legacy })!;
    await storage.setItem(KEY, raw);
    assert.equal(await storage.getItem(KEY), raw);
  });

  it("reports write failures without unhandled rejection or deleting earlier data", async () => {
    const legacy = legacyStorage({ [KEY]: "earlier" });
    const errors: ProjectStorageError[] = [];
    legacy.setItem = () => { throw new Error("quota"); };
    const storage = createProjectStorage({ backend: null, legacyStorage: legacy, onError: (error) => { errors.push(error); throw new Error("notification failed"); } })!;
    await assert.doesNotReject(storage.setItem(KEY, "oversized"));
    assert.equal(legacy.getItem(KEY), "earlier");
    assert.equal(errors[0].operation, "write");
  });

  it("does not overwrite unreadable durable data with defaults, or restore a stale legacy copy", async () => {
    const durable = durableStorage({ [KEY]: "latest" });
    const legacy = legacyStorage({ [KEY]: "older" });
    const errors: ProjectStorageError[] = [];
    const read = durable.backend.getItem;
    durable.backend.getItem = async () => { throw new Error("read failure"); };
    const storage = createProjectStorage({ backend: durable.backend, legacyStorage: legacy, onError: (error) => errors.push(error) })!;
    await assert.rejects(Promise.resolve(storage.getItem(KEY)), /read failure/);
    await storage.setItem(KEY, "empty defaults");
    assert.equal(durable.data.get(KEY), "latest");
    assert.equal(legacy.getItem(KEY), "older");
    durable.backend.getItem = read;
    assert.equal(await storage.getItem(KEY), "latest");
    await storage.setItem(KEY, "new edit");
    assert.equal(durable.data.get(KEY), "new edit");
    assert.deepEqual(errors.map((error) => error.operation), ["read", "write"]);
  });

  it("uses atomic legacy fallback only without IndexedDB and removes both stores", async () => {
    const legacy = legacyStorage();
    const fallback = createProjectStorage({ backend: null, legacyStorage: legacy })!;
    await fallback.setItem(KEY, "small project");
    assert.equal(await fallback.getItem(KEY), "small project");
    const durable = durableStorage({ [KEY]: "new project" });
    const storage = createProjectStorage({ backend: durable.backend, legacyStorage: legacy })!;
    await storage.removeItem(KEY);
    assert.equal(legacy.getItem(KEY), null);
    assert.equal(await storage.getItem(KEY), null);
  });
});
