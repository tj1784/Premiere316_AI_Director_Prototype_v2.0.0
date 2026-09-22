import {
  hydrateProductionRouting,
  type ProductionModelBinding,
  type ProductionRoleId,
} from "./production-profiles.ts";
import type { Picture } from "./types.ts";
import type { MoviePlanRuntime } from "./movie-plan-pipeline.ts";

export function productionRoleForStep(step: string): ProductionRoleId {
  if (step === "screenplayQa") return "reviewer";
  if (step === "screenplay") return "writer";
  if (["assetPrompts", "assetReferences", "assetReferenceChoice", "promptLab"].includes(step))
    return "prompt-cue";
  return "architect";
}

export function profileTextRuntime(
  picture: Picture,
  generate: (request: {
    requestId: string;
    binding: ProductionModelBinding;
    system: string;
    prompt: string;
  }) => Promise<{ text: string }>,
  entryRole: ProductionRoleId = "architect",
): MoviePlanRuntime {
  const routing = hydrateProductionRouting(picture.productionRouting, {
    legacyLocalSelection: Boolean(
      picture.screenplay.pinnedWriterServedId || picture.screenplay.selectedModelId,
    ),
  });
  const bindings = structuredClone(routing.bindings);
  const entry = bindings.find((binding) => binding.role === entryRole);
  const usable = (binding?: ProductionModelBinding) =>
    Boolean(binding?.callableModelId && ["installed", "loaded"].includes(binding.status));
  if (!usable(entry))
    return {
      available: false,
      reason:
        entry?.statusReason ||
        "Refresh the production profile. No model substitution is permitted.",
      servedModelId: null,
      generate: null,
    };
  return {
    available: true,
    reason: "",
    servedModelId: entry!.callableModelId,
    displayName: entry!.label,
    generate: async ({ stepId, system, prompt }) => {
      const binding = bindings.find(
        (candidate) => candidate.role === productionRoleForStep(stepId),
      );
      if (!usable(binding))
        throw new Error(binding?.statusReason || `No callable profile binding for ${stepId}.`);
      return generate({
        requestId: `profile-text:${picture.id}:${crypto.randomUUID()}`,
        binding: binding!,
        system,
        prompt,
      });
    },
  };
}
