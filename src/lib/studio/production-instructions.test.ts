import { test } from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_PRODUCTION_INSTRUCTIONS, getGlobalProductionInstructions, setGlobalProductionInstructions, withProductionInstructions } from "./production-instructions.ts";

test("one app-wide instruction setting is reused across pictures and all model prompts", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const rows = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => rows.set(key, value) } });
  try {
    assert.equal(getGlobalProductionInstructions(), GLOBAL_PRODUCTION_INSTRUCTIONS);
    setGlobalProductionInstructions("Every picture: read its screenplay. 1024 token character sheets.");
    assert.equal(rows.size, 1);
    for (const phase of ["Picture A screenplay", "Picture B asset prompts", "Story Doctor"]) {
      assert.match(withProductionInstructions(phase), /^Every picture: read its screenplay/);
    }
    const once = withProductionInstructions("Task");
    assert.equal(withProductionInstructions(once), once);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
