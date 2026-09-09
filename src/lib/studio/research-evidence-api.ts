import { createServerFn } from "@tanstack/react-start";
import type { PictureIntake } from "./picture-intake.ts";

export const collectPictureResearchEvidence = createServerFn({ method: "POST" })
  .validator((input: { intake: PictureIntake; allowSearch: boolean }) => {
    if (!input?.intake || typeof input.intake !== "object" || JSON.stringify(input.intake).length > 1_000_000) throw new Error("Invalid research intake.");
    for (const field of ["sourcePassages", "suppliedSourceText", "sourceMaterial", "directorNotes", "historicalPeriod", "culturalSocialWorld"] as const) {
      if (typeof input.intake[field] !== "string") throw new Error(`Invalid research field: ${field}.`);
    }
    if (!Array.isArray(input.intake.importedSources) || input.intake.importedSources.some((source) => typeof source.text !== "string" || typeof source.fileName !== "string")) throw new Error("Invalid imported research sources.");
    return { intake: input.intake, allowSearch: input.allowSearch === true };
  })
  .handler(async ({ data }) => {
    const { collectResearchEvidence } = await import("./research-evidence.server.ts");
    return collectResearchEvidence(data.intake, { allowSearch: data.allowSearch });
  });
