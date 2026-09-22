import { open, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, basename, dirname, join } from "node:path";
import { createLMStudioProvider } from "./lmstudio-provider.server.ts";
import { inspectGgufVariant } from "./model-scan.server.ts";
import { DEFAULT_SCREENPLAY_SETTINGS } from "./screenplay.ts";
import {
  GAIN_MODEL_ID,
  GAIN_REGULAR_PATH,
  localProductionBindings,
  type ProductionModelBinding,
} from "./production-profiles.ts";
import { ensureMoviePlanModel } from "./movie-plan-api.ts";
import { installedBibleArtifact } from "./bible-model-identity.server.ts";
import { generateAstraUnit } from "./astra-adapter.server.ts";
import { durableBibleRequest } from "./bible-request-ledger.server.ts";

let busy = false;
const unresolvedResidency = new Set<string>();
const results = new Map<string, { text: string; modelId: string; evidenceJson: string }>();
const failures = new Map<string, string>();

export async function inspectBibleModel(
  binding: ProductionModelBinding,
  actualPath: string | null,
) {
  const first = await inspectBibleShard(binding, actualPath);
  const split = basename(first.path).match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
  const shards = [first];
  if (split) {
    const count = Number(split[3]);
    if (count < 1 || count > 128) throw new Error("Invalid split artifact count.");
    for (let n = 1; n <= count; n++) {
      const file = join(
        dirname(first.path),
        `${split[1]}-${String(n).padStart(5, "0")}-of-${split[3]}.gguf`,
      );
      if (file.toLowerCase() !== first.path.toLowerCase())
        shards.push(await inspectBibleShard(binding, file));
    }
  }
  return {
    ...first,
    shards,
    artifactFingerprint: createHash("sha256")
      .update(JSON.stringify(shards.map((s) => [s.path, s.size, s.modifiedAt, s.headerSha256])))
      .digest("hex"),
  };
}
async function inspectBibleShard(binding: ProductionModelBinding, actualPath: string | null) {
  if (!actualPath || !isAbsolute(actualPath))
    throw new Error(
      `Needs verification: native discovery did not resolve the exact artifact path for ${binding.callableModelId}.`,
    );
  const path = await realpath(actualPath);
  if (
    binding.callableModelId === GAIN_MODEL_ID &&
    path.toLowerCase() !== (await realpath(GAIN_REGULAR_PATH)).toLowerCase()
  )
    throw new Error("GAIN alias resolves to a different artifact. No inference was dispatched.");
  const info = await stat(path);
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(info.size, 32 * 1024 * 1024));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    const evidence = inspectGgufVariant(header);
    if (evidence.mtp || !evidence.complete || !evidence.architecture)
      throw new Error("MTP weights or incomplete artifact evidence: dispatch blocked.");
    if (
      binding.callableModelId === GAIN_MODEL_ID &&
      (evidence.fileType !== 7 || !/gain/i.test(evidence.name))
    )
      throw new Error("GAIN regular Q8_0 identity is not established by GGUF metadata.");
    return {
      path,
      size: info.size,
      modifiedAt: info.mtimeMs,
      headerSha256: createHash("sha256").update(header).digest("hex"),
      ...evidence,
      inspectedAt: Date.now(),
    };
  } finally {
    await file.close();
  }
}

export async function generateBibleUnit(input: {
  requestId: string;
  binding: ProductionModelBinding;
  system: string;
  prompt: string;
  reconcileOnly?: boolean;
}) {
  const { reconcileOnly, ...payload } = input;
  return durableBibleRequest(input.requestId, payload, !!reconcileOnly, () =>
    performBibleUnit(payload),
  );
}
async function performBibleUnit(input: {
  requestId: string;
  binding: ProductionModelBinding;
  system: string;
  prompt: string;
}) {
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const prior = results.get(fingerprint);
  if (prior) return prior;
  if (failures.has(fingerprint)) throw new Error(failures.get(fingerprint));
  if (busy)
    throw new Error("Another Bible text request owns the local crew. No second model was loaded.");
  const expected = localProductionBindings().find((b) => b.role === input.binding.role);
  if (input.binding.provider === "astra") {
    busy = true;
    try {
      const result = await generateAstraUnit({
        ...input,
        modelId: input.binding.callableModelId ?? "",
      });
      results.set(fingerprint, result);
      return result;
    } finally {
      busy = false;
    }
  }
  if (!expected || input.binding.callableModelId !== expected.callableModelId)
    throw new Error("Role binding differs from the selected local crew snapshot.");
  if (input.prompt.length + input.system.length > 70000)
    throw new Error(
      "The complete context packet exceeds this adapter's conservative context budget. It was not truncated.",
    );
  const provider = createLMStudioProvider();
  busy = true;
  let owned = false;
  let modelId = "";
  try {
    const discovery = await provider.discover();
    if (!discovery.available) throw new Error(discovery.reason);
    const nativeModels = await provider.verifiedNativeModels();
    for (const unresolved of unresolvedResidency) {
      if (nativeModels.some(m => m.id === unresolved && m.loaded)) throw new Error(`Previous load/release ownership for ${unresolved} is unresolved. Release that exact model explicitly before another crew request; unrelated models are preserved.`);
      unresolvedResidency.delete(unresolved);
    }
    const matches = nativeModels.filter((m) => m.id === expected.callableModelId);
    if (matches.length !== 1)
      throw new Error(
        `Exact installed model unavailable or ambiguous: ${expected.callableModelId}`,
      );
    const model = matches[0];
    modelId = model.id;
    const evidence = await inspectBibleModel(
      expected,
      model.path ?? (await installedBibleArtifact(modelId)),
    );
    if (nativeModels.some((m) => m.loaded && m.id !== modelId))
      throw new Error(
        "An unrelated model is resident. It has been preserved; release it explicitly before running the sequential crew.",
      );
    if (!model.loaded) {
      unresolvedResidency.add(modelId);
      await ensureMoviePlanModel({
        data: { servedModelId: modelId, endpoint: discovery.endpoint },
      });
      owned = true;
    }
    const settings = { ...DEFAULT_SCREENPLAY_SETTINGS, maxTokens: 8192 };
    // Establish the exact provider-owned instance before any subsequent check can fail.
    await provider.load({ servedModelId: modelId, settings });
    const verified = (await provider.discover()).models.find((m) => m.id === modelId && m.loaded);
    if (!verified?.instanceId) throw new Error("Exact loaded instance could not be verified.");
    if (verified.speculativeDraft)
      throw new Error(
        "Auxiliary speculative draft weights are enabled. Their artifact identity is unverified; Bible dispatch is blocked.",
      );
    settings.maxTokens = Math.min(8192, Math.floor((verified.contextLength ?? 0) / 3));
    if (
      !verified.contextLength ||
      settings.maxTokens < 512 ||
      Buffer.byteLength(input.prompt + input.system, "utf8") + settings.maxTokens >
        verified.contextLength
    )
      throw new Error(
        "The complete input plus output reserve exceeds the verified instance context (conservative byte/token bound). No context was truncated.",
      );
    const after = await inspectBibleModel(
      expected,
      verified.path ?? (await installedBibleArtifact(modelId)),
    );
    if (after.artifactFingerprint !== evidence.artifactFingerprint)
      throw new Error("Artifact changed between discovery and dispatch.");
    const output = await provider.generate(
      {
        runId: input.requestId,
        stepId: "bible-unit",
        system: input.system,
        prompt: input.prompt,
        useModelDefaults: true,
      },
      { servedModelId: modelId, settings },
    );
    const result = {
      text: output.text,
      modelId,
      evidenceJson: JSON.stringify({
        ...evidence,
        instanceId: verified.instanceId,
        ownership: owned ? "run-owned" : "borrowed",
        settings,
        promptTokens: output.promptTokens,
        generatedTokens: output.generatedTokens,
      }),
    };
    results.set(fingerprint, result);
    if (results.size > 100) results.delete(results.keys().next().value!);
    return result;
  } catch (error) {
    failures.set(
      fingerprint,
      `Request failed; automatic replay is disabled to avoid an ambiguous duplicate: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    try {
      if (owned || unresolvedResidency.has(modelId)) {
        if (owned) await provider.releaseResident("user-explicit");
        if ((await provider.verifiedNativeModels()).some((m) => m.id === modelId && m.loaded))
          throw new Error(
            "Run-owned model release was not verified. Further crew dispatch is blocked until reconciled.",
          );
        unresolvedResidency.delete(modelId);
      }
    } finally {
      busy = false;
    }
  }
}
