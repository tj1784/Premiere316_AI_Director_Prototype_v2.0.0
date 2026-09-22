import { pathToFileURL } from "node:url";
import { isAbsolute } from "node:path";

/** Installation-level provider adapter. Credentials remain entirely server-side. */
export type AstraAdapter = {
  discover(): Promise<{
    available: boolean;
    reason: string;
    modelId: string;
    provider: string;
    supportedEfforts: string[];
    maxInputCharacters: number;
    maxOutputTokens: number;
  }>;
  generate(input: {
    requestId: string;
    modelId: string;
    effort: "ultra";
    system: string;
    prompt: string;
    maxOutputTokens: number;
  }): Promise<{
    text: string;
    modelId: string;
    effort: string;
    inputTokens?: number;
    outputTokens?: number;
  }>;
};
export async function configuredAstraAdapter(): Promise<AstraAdapter> {
  const modulePath = process.env.PREMIERE316_ASTRA_ADAPTER;
  if (!modulePath || !isAbsolute(modulePath))
    throw new Error(
      "Astra setup required: configure PREMIERE316_ASTRA_ADAPTER with an absolute server-side adapter module path. The adapter must discover the actual provider/model and Ultra capability.",
    );
  const loaded = await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
  const adapter = loaded.default as AstraAdapter;
  if (!adapter || typeof adapter.discover !== "function" || typeof adapter.generate !== "function")
    throw new Error("Configured Astra adapter must export discover() and generate().");
  return adapter;
}
export async function discoverAstraBinding(adapter?: AstraAdapter) {
  try {
    const info = await (adapter ?? (await configuredAstraAdapter())).discover();
    if (
      !info.available ||
      !info.modelId ||
      !info.provider ||
      !info.supportedEfforts.includes("ultra") ||
      !Number.isFinite(info.maxInputCharacters) ||
      info.maxInputCharacters <= 0 ||
      !Number.isFinite(info.maxOutputTokens) ||
      info.maxOutputTokens <= 0
    )
      throw new Error(
        info.reason ||
          "The configured provider has not verified an Astra model and Ultra effort capability.",
      );
    return {
      ...info,
      available: true,
      reason:
        "Configured Astra binding supports Ultra; live inference is not established by discovery.",
    };
  } catch (error) {
    return {
      available: false,
      modelId: "",
      provider: "",
      supportedEfforts: [] as string[],
      maxInputCharacters: 0,
      maxOutputTokens: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
export async function generateAstraUnit(
  input: {
    requestId: string;
    modelId: string;
    system: string;
    prompt: string;
  },
  suppliedAdapter?: AstraAdapter,
) {
  const adapter = suppliedAdapter ?? (await configuredAstraAdapter());
  const info = await discoverAstraBinding(adapter);
  if (!info.available || info.modelId !== input.modelId)
    throw new Error(info.reason || "Astra binding changed since the run snapshot.");
  if (input.system.length + input.prompt.length > info.maxInputCharacters)
    throw new Error(
      "Complete source packet exceeds the configured Astra context limit; no source was truncated.",
    );
  const output = await adapter.generate({
    ...input,
    effort: "ultra",
    maxOutputTokens: info.maxOutputTokens,
  });
  if (output.modelId !== info.modelId || output.effort !== "ultra" || !output.text.trim())
    throw new Error(
      "Astra returned a different model/effort or empty output. No fallback result was applied.",
    );
  return {
    text: output.text,
    modelId: output.modelId,
    evidenceJson: JSON.stringify({
      provider: info.provider,
      effort: output.effort,
      inputTokens: output.inputTokens,
      outputTokens: output.outputTokens,
    }),
  };
}
