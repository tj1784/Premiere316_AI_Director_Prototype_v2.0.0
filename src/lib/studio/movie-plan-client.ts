import { withProductionInstructions } from "./production-instructions.ts";
import { visualDirectionText } from "./visual-direction.ts";
import { BrowserEndpointCache } from "./local-llm-endpoint.ts";
import { releaseMoviePlanModel, countAssetPromptTokens } from "./movie-plan-api.ts";

export async function releaseMoviePlanWriterForImages(servedModelId: string, picture?: Picture) {
  if (picture?.productionRouting?.profileId === "astra-ultra") return { released: true };
  return releaseMoviePlanModel({ data: { servedModelId, endpoint: endpointCache.get() } });
}
import {
  executeMoviePlan,
  executeResearchDraft,
  type MoviePlanRuntime,
} from "./movie-plan-pipeline.ts";
import type { Picture } from "./types.ts";
import type { InternalPhase } from "./product-flow.ts";
import type { MoviePlanProgress } from "./movie-plan-stream.ts";
import { writeGroundedAssetPrompts } from "./asset-prompt-pipeline.ts";
import { isVisualAsset } from "./asset-prompt-context.ts";
import { extractJsonObject } from "./movie-plan-pipeline.ts";
import { researchAssetReference } from "./asset-reference-search.ts";
import { collectPictureResearchEvidence } from "./research-evidence-api.ts";
import { generateBibleText } from "./bible-api.ts";
import { profileTextRuntime } from "./profile-text-runtime.ts";
import { bibleAuthoringContext } from "./movie-bible.ts";
import type { ProductionRoleId } from "./production-profiles.ts";
import {
  appendResearchEvidence,
  explicitResearchRequest,
  forbidsWebResearch,
  hasReusableApprovedEvidence,
  hasSubstantiveSuppliedEvidence,
  RESEARCH_EVIDENCE_REQUIRED,
  requiresHistoricalEvidence,
  suppliedResearchUrls,
} from "./research-evidence.ts";

export async function findAssetReferencesOnServer(
  picture: Picture,
  onProgress: (message: string) => void,
  onPicture: (picture: Picture) => void,
  onModelProgress?: (event: MoviePlanProgress) => void,
): Promise<Picture> {
  const image = window.premiere316?.image;
  if (!image) throw new Error("Visual reference research requires Premiere316.");
  onProgress("Checking the selected local model for visual reference research…");
  const runtime = await runtimeFromStatus(picture, onModelProgress, undefined, "prompt-cue");
  if (!runtime.available || !runtime.generate) throw new Error(runtime.reason);
  const generate = runtime.generate;
  const assets = picture.production?.assets.filter(isVisualAsset) ?? [];
  onProgress("The local model is choosing visual reference searches…");
  const requested = extractJsonObject(
    (
      await runtime.generate({
        stepId: "assetReferences",
        system:
          "Choose up to four public web image-reference searches for this film's distinctive assets when text alone is insufficient. Prioritize exact costume silhouettes, complex props and historical construction. Prefer museum, auction and original production sources. A reference is a visual target, not proof that a film costume is historical. Do not invent search results or URLs. Use exact asset IDs; group assets that should share one reference (for example a character and their robe). Return an empty list when adequate references are already attached.",
        prompt: JSON.stringify({
          brief: picture.intake.concept,
          fidelity: picture.intake.fidelityRequirements,
          screenplay: picture.screenplay.workingFountain,
          assets: assets.map((asset) => ({
            id: asset.id,
            name: asset.name,
            spec: asset.canonicalSpec,
            references: asset.references,
          })),
        }),
      })
    ).text,
  ).searches;
  if (!Array.isArray(requested) || requested.length > 4)
    throw new Error("Invalid visual reference search plan.");
  let next = picture;
  const failures: string[] = [];
  for (const request of requested) {
    const ids = Array.isArray(request.assetIds) ? request.assetIds : [];
    if (!ids.length || ids.some((id: string) => !assets.some((asset) => asset.id === id)))
      throw new Error("Visual reference request contains an unknown asset.");
    try {
      const candidate = await researchAssetReference(String(request.query), {
        search: async (query) => {
          const candidates = await image.searchReferences(query);
          onProgress(`Found ${candidates.length} reference candidates for: ${query}`);
          return candidates;
        },
        progress: onProgress,
        choose: async (query, candidates) => {
          const choice = extractJsonObject(
            (
              await generate({
                stepId: "assetReferenceChoice",
                system:
                  "Select the most relevant visual reference from these real web search results. Choose by source description and provenance; you have not viewed the image pixels, so never claim to see image details. Prefer the original artifact or costume. A clearly described historical reconstruction is also suitable as a visual design reference; do not reject it merely because it is a reconstruction. Reject logos, shopping collages and unrelated modern events. This is visual research for a film, not a claim of archaeological proof. Return its zero-based index, or -1 if none fits. Refer only to candidates actually provided. Explain rejection so the search can be refined. Do not invent URLs.",
                prompt: JSON.stringify({ query, purpose: request.reason, candidates }),
              })
            ).text,
          );
          onProgress(`Reference selection: ${String(choice.reason ?? "No explanation returned")}`);
          return { index: Number(choice.index), reason: String(choice.reason ?? "") };
        },
        refine: async (query, feedback) => {
          const plan = extractJsonObject(
            (
              await generate({
                stepId: "assetReferences",
                system:
                  "Revise one failed visual reference search. Return exactly one search. Use a short searchable artifact, museum object, or named production costume query. Remove cinematic adjectives and unnecessary requirements. Preserve the visual purpose. Do not invent URLs, search results, catalogue numbers or object identifiers. Broaden a failed query rather than adding speculative detail.",
                prompt: JSON.stringify({ query, feedback, purpose: request.reason, assetIds: ids }),
              })
            ).text,
          );
          return String(Array.isArray(plan.searches) ? (plan.searches[0]?.query ?? "") : "");
        },
      });
      onProgress(`Attaching reference: ${candidate.title} · ${candidate.sourceUrl}`);
      const imported = await image.importWebReference(candidate);
      const now = Date.now();
      next = {
        ...next,
        production: {
          ...next.production!,
          assets: next.production!.assets.map((asset) =>
            ids.includes(asset.id)
              ? {
                  ...asset,
                  references: [
                    ...asset.references.filter((reference) => reference.uri !== imported.uri),
                    {
                      id: `webref:${imported.sha256}`,
                      name: `${candidate.title} — ${request.reason} — Source: ${candidate.sourceUrl}`,
                      uri: imported.uri,
                      mediaType: "image/png",
                      preferred: true,
                      uploadedAt: now,
                      provenance: {
                        sourceType: "user" as const,
                        screenplayVersionId: next.screenplay.currentVersionId ?? "",
                        sceneIds: asset.requiredSceneIds,
                        createdAt: now,
                      },
                    },
                  ],
                  updatedAt: now,
                }
              : asset,
          ),
        },
        updatedAt: now,
      };
      onPicture(next);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      onProgress(
        `Reference search warning: ${failures[failures.length - 1]} Keeping saved references and continuing the remaining searches.`,
      );
    }
  }
  if (failures.length)
    onProgress(
      `${failures.length} optional reference search(es) could not supply an image. Continuing prompt writing with the screenplay, cinematography and successfully attached references. No missing reference is invented.`,
    );
  else
    onProgress("Visual reference research complete. Attached images and source links are saved.");
  return next;
}

const endpointCache = new BrowserEndpointCache();

async function runtimeFromStatus(
  picture: Picture,
  onProgress?: (event: MoviePlanProgress) => void,
  onStatus?: (message: string) => void,
  entryRole: ProductionRoleId = "architect",
): Promise<MoviePlanRuntime> {
  const runtime = profileTextRuntime(
    picture,
    async (request) =>
      generateBibleText({
        data: {
          ...request,
          system:
            withProductionInstructions(request.system) +
            "\n\n" +
            visualDirectionText(picture.intake.visualDirection),
          prompt:
            request.prompt +
            "\n\nCANONICAL BIBLE CONTEXT:\n" +
            JSON.stringify(bibleAuthoringContext(picture)),
        },
      }),
    entryRole,
  );
  const generate = runtime.generate;
  if (!generate) return runtime;
  onStatus?.(
    `Using the selected production profile: ${runtime.displayName}. Exact model verification occurs at dispatch.`,
  );
  return {
    ...runtime,
    generate: async (input) => {
      const progress = (status: MoviePlanProgress["status"], text = "", message?: string) =>
        onProgress?.({
          phase: input.stepId,
          model: runtime.servedModelId ?? "Production profile",
          status,
          text,
          reasoning: "",
          message,
        });
      progress("generating");
      try {
        const result = await generate(input);
        progress("completed", result.text);
        return result;
      } catch (error) {
        progress("failed", "", error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };
}

export async function prepareResearchEvidenceOnServer(
  picture: Picture,
  onProgress?: (event: MoviePlanProgress) => void,
): Promise<Picture> {
  if (hasReusableApprovedEvidence(picture)) return picture;
  const report = (status: MoviePlanProgress["status"], message: string) =>
    onProgress?.({
      phase: "research",
      model: "Source research",
      status,
      text: "",
      reasoning: "",
      message,
    });
  const allowSearch =
    !forbidsWebResearch(picture.intake) &&
    (picture.research?.content.mode === "web-assisted-opt-in" ||
      explicitResearchRequest(picture.intake));
  const suppliedUrls = forbidsWebResearch(picture.intake)
    ? []
    : suppliedResearchUrls(picture.intake);
  if (!allowSearch && !suppliedUrls.length) {
    if (
      requiresHistoricalEvidence(picture.intake) &&
      !hasSubstantiveSuppliedEvidence(picture.intake)
    ) {
      report("failed", RESEARCH_EVIDENCE_REQUIRED);
      throw new Error(RESEARCH_EVIDENCE_REQUIRED);
    }
    report(
      "completed",
      "Using supplied source text. No public sources have been retrieved or independently verified.",
    );
    return picture;
  }
  report("generating", "Collecting source text and provenance before screenplay drafting…");
  const result = await collectPictureResearchEvidence({
    data: { intake: picture.intake, allowSearch },
  });
  const intake = appendResearchEvidence(picture.intake, result.documents);
  if (requiresHistoricalEvidence(intake) && !hasSubstantiveSuppliedEvidence(intake)) {
    const detail = result.warnings.slice(0, 2).join(" ");
    const message = `${RESEARCH_EVIDENCE_REQUIRED}${detail ? ` Source retrieval: ${detail}` : ""}`;
    report("failed", message);
    throw new Error(message);
  }
  const warnings = result.warnings.length
    ? ` ${result.warnings.length} source request(s) could not supply readable text; those pages are not evidence.`
    : "";
  report(
    "completed",
    `${result.documents.length} public source page(s) retrieved with URLs and retrieval dates. Supplied text remains identified as supplied evidence.${warnings}`,
  );
  return { ...picture, intake };
}

export async function executeMoviePlanOnServer(
  picture: Picture,
  onProgress?: (event: MoviePlanProgress) => void,
  fromCompletedScreenplay = false,
  onPicture?: (picture: Picture) => void,
) {
  if (!fromCompletedScreenplay)
    picture = await prepareResearchEvidenceOnServer(picture, onProgress);
  onPicture?.(picture);
  return executeMoviePlan(picture, {
    runtime: await runtimeFromStatus(picture, onProgress),
    fromCompletedScreenplay,
    onPicture,
  });
}

export async function executeResearchDraftOnServer(
  picture: Picture,
  onPicture?: (picture: Picture) => void,
  onProgress?: (event: MoviePlanProgress) => void,
) {
  picture = await prepareResearchEvidenceOnServer(picture, onProgress);
  onPicture?.(picture);
  return executeResearchDraft(picture, { runtime: await runtimeFromStatus(picture, onProgress) });
}

export async function writeAssetPromptsOnServer(
  picture: Picture,
  onProgress?: (event: MoviePlanProgress) => void,
  replaceEditedPrompts = false,
  onPicture?: (picture: Picture) => void,
  onStatus?: (message: string) => void,
  onlyAssetId?: string,
  forceRewrite = false,
) {
  onPicture?.(picture);
  onStatus?.("Checking the selected profile prompt writer…");
  return writeGroundedAssetPrompts(
    picture,
    await runtimeFromStatus(picture, onProgress, onStatus, "prompt-cue"),
    async (prompt) =>
      (await countAssetPromptTokens({ data: { prompt, engineId: picture.selectedEngine?.image } }))
        .count,
    replaceEditedPrompts,
    onPicture,
    onStatus,
    onlyAssetId,
    forceRewrite,
  );
}

export type { InternalPhase };
