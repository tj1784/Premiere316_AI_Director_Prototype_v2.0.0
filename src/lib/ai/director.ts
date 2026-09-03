import { createServerFn } from "@tanstack/react-start";
import type { StillExposeInput } from "@/lib/desktop/protocol.ts";

/**
 * Local generation entry points only.
 *
 * Premiere316 never falls back to a hosted inference API. Text generation is
 * provided by the loopback LM Studio workflow and motion/audio adapters remain
 * unavailable until a native local adapter passes its capability gate.
 */
export const generateStill = createServerFn({ method: "POST" })
  .validator(
    (input: StillExposeInput) => ({
      prompt: input.prompt,
      engineId: input.engineId ?? "",
      engineName: input.engineName ?? "",
      references: (input.references ?? []).filter((uri) => typeof uri === "string" && uri.startsWith("data:image/")).slice(0, 3),
      selectedBasePath: input.selectedBasePath ?? "",
      values: input.values ?? {},
    }),
  )
  .handler(async ({ data }) => {
    const { exposeLocalStill } = await import("@/lib/studio/local-still.server.ts");
    return exposeLocalStill({
      prompt: data.prompt,
      engineId: data.engineId,
      engineName: data.engineName,
      references: data.references,
      selectedBasePath: data.selectedBasePath,
      values: data.values,
    });
  });

export const wakeLocalEngine = createServerFn({ method: "POST" }).handler(async () => {
  const { ensureLocalEngine } = await import("@/lib/studio/local-still.server.ts");
  return ensureLocalEngine();
});
