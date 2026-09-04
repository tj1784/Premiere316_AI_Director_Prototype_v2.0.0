import { createServerFn } from "@tanstack/react-start";

type DisabledStillInput = {
  prompt?: string;
  engineId?: string;
  engineName?: string;
  references?: string[];
  selectedBasePath?: string;
  values?: Record<string, unknown>;
};

/**
 * Browser/server-function generation is fail-closed. Packaged desktop prepared
 * asset authorization is the only native image path.
 */
export const generateStill = createServerFn({ method: "POST" })
  .validator((input: DisabledStillInput) => ({
    prompt: input.prompt ?? "",
    engineId: input.engineId ?? "",
    engineName: input.engineName ?? "",
    references: (input.references ?? []).filter((uri: string) => typeof uri === "string" && uri.startsWith("data:image/")).slice(0, 3),
    selectedBasePath: input.selectedBasePath ?? "",
    values: input.values ?? {},
  }))
  .handler(async () => ({
    ok: false as const,
    error: "Native still generation is disabled outside the packaged prepared-asset workflow.",
  }));

export const wakeLocalEngine = createServerFn({ method: "POST" }).handler(async () => ({
  ok: false as const,
  error: "Free-standing model wake is disabled; use the packaged prepared-asset generation action.",
}));
