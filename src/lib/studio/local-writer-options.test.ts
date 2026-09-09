import test from "node:test";
import assert from "node:assert/strict";
import { localWriterOptions, type LocalWriterStatus } from "./local-writer-options.ts";
import type { LocalLLMServedModel } from "./local-llm-provider.ts";
import type { ScreenplayModelRef } from "./screenplay.ts";

const model = (id: string, patch: Partial<LocalLLMServedModel> = {}): LocalLLMServedModel => ({ id, displayName: id, type: "llm", loaded: false, instanceId: null, path: null, precision: null, quantization: null, contextLength: null, sizeBytes: null, ...patch });
const metadata = (patch: Partial<ScreenplayModelRef>): ScreenplayModelRef => ({ id: "catalog:writer", servedModelId: "", localCatalogModelId: "writer", displayName: "Catalog writer", checkpoint: "catalog-only.gguf", precision: "Q4", quantization: "Q4", contextLength: 32768, sizeBytes: 10, runtimeAdapter: "LM Studio", status: "unavailable", statusReason: "Not loaded", ...patch });
function status(models: LocalLLMServedModel[], references: ScreenplayModelRef[] = []): LocalWriterStatus {
  return { provider: { providerId: "lm-studio", providerName: "LM Studio", endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "Native model listing", models, discoveredAt: 1 }, models: references };
}

test("shows unloaded provider writers with their exact real load keys, without inventing catalog keys", () => {
  const discovery = status([model("publisher/writer-q4", { displayName: "Writer Q4", path: "D:/models/actual.gguf" })], [metadata({ checkpoint: "D:/models/actual.gguf" }), metadata({ id: "catalog:other", checkpoint: "D:/models/other.gguf" })]);
  assert.deepEqual(localWriterOptions(discovery), [{ id: "publisher/writer-q4", displayName: "Writer Q4", loaded: false }]);
});

test("uses exact served metadata and native loaded state, without family or substring matching", () => {
  const discovery = status([model("writer"), model("writer-large", { loaded: true })], [metadata({ servedModelId: "writer-large", displayName: "Large writer", status: "ready" }), metadata({ servedModelId: "writer", displayName: "Small writer", status: "ready" })]);
  assert.deepEqual(localWriterOptions(discovery), [{ id: "writer-large", displayName: "Large writer", loaded: true }, { id: "writer", displayName: "Small writer", loaded: false }]);
});

test("deduplicates exact IDs and prefers the loaded instance regardless of listing order", () => {
  for (const rows of [[model("writer"), model("writer", { loaded: true })], [model("writer", { loaded: true }), model("writer")]]) assert.deepEqual(localWriterOptions(status(rows)), [{ id: "writer", displayName: "writer", loaded: true }]);
});

test("filters embedding, unknown and empty IDs while retaining distinct provider keys", () => {
  const discovery = status([model("embed", { type: "embedding" }), model("unknown", { type: "unknown" }), model(" "), model("writer-Q4"), model("writer-Q8")]);
  assert.deepEqual(localWriterOptions(discovery).map((option) => option.id), ["writer-Q4", "writer-Q8"]);
});

test("offline or missing discovery cannot expose stale catalog or provider entries", () => {
  const discovery = status([model("writer", { loaded: true })], [metadata({ servedModelId: "writer", status: "ready" })]);
  discovery.provider.available = false;
  assert.deepEqual(localWriterOptions(discovery), []);
  assert.deepEqual(localWriterOptions(null), []);
});
