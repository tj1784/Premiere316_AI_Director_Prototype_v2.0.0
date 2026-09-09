import { getGlobalProductionInstructions } from "./production-instructions.ts";
import type { Picture } from "./types.ts";
import type { MoviePlanRuntime } from "./movie-plan-pipeline.ts";
import { extractJsonObject } from "./movie-plan-pipeline.ts";
import { assetPromptContext, assertCharacterSheetPrompt, isVisualAsset, type AssetPromptSource } from "./asset-prompt-context.ts";
import { assetPromptText } from "./asset-prompt-output.ts";

export async function writeGroundedAssetPrompts(picture: Picture, runtime: MoviePlanRuntime, countTokens: (prompt: string) => Promise<number>, replaceEditedPrompts = false, onPicture?: (picture: Picture) => void, onStatus?: (message: string) => void, onlyAssetId?: string, forceRewrite = false): Promise<Picture> {
  if (!runtime.available || !runtime.generate || !runtime.servedModelId) throw new Error(runtime.reason || "The selected local prompt writer is unavailable.");
  if (picture.production?.requirements.some((requirement) => requirement.evidenceNote === "Extracted from generated screenplay.")) {
    picture = { ...picture, production: { ...picture.production, assets: picture.production.assets.map((asset) => asset.requirementIds.length && asset.requirementIds.every((id) => id.startsWith("local:"))
      ? { ...asset, tombstone: true, stale: true, staleReasons: [...asset.staleReasons, "Keyword-only supplement retired; the model's screenplay breakdown is authoritative."] }
      : asset) } };
    onPicture?.(picture);
  }
  const visualAssets = picture.production?.assets.filter(isVisualAsset) ?? [];
  const assets = onlyAssetId ? visualAssets.filter((asset) => asset.id === onlyAssetId) : visualAssets;
  if (!assets.length) throw new Error("No screenplay assets exist.");
  const imageEngineId = picture.selectedEngine?.image ?? "flux2";
  const imageLabel = imageEngineId === "krea-2" ? "KREA 2 RAW" : "FLUX.2";
  const tokenizerModel = imageEngineId === "krea-2" ? "Qwen/Qwen3-VL-4B-Instruct" : "mistralai/Mistral-Small-3.1-24B-Instruct-2503";
  const contexts = assets.map((asset) => assetPromptContext(picture, asset));
  let next = picture;
  for (const [index, asset] of assets.entries()) {
    const shared = contexts[index].context;
    const categoryInstructions = asset.category === "vfx" ? "EFFECTS REFERENCE: Show the named natural or supernatural phenomenon as a believable physical event in its screenplay environment. Describe organic irregular shapes and visible interactions: flame tongues, billowing smoke, turbulent water, reflected light, spray and disturbed surfaces as relevant. Do not turn fire or water into a smooth geometric cone, cylinder, crystal, laser or solid luminous object unless that shape is explicitly required by the screenplay. Do not invent numerical radii, temperatures or material equations. Use source-specified scale and otherwise describe scale visually. For a luminous effect, show its light visibly reaching the surrounding ground and relevant figures with readable exposure, not an isolated glowing object in near-black surroundings. Keep this a single photographic reference frame, without diagrams or printed text. " : "";
    const previous = next.assetPromptSources?.[asset.id];
    if (!forceRewrite && !onlyAssetId && previous?.contextHash === contexts[index].hash && previous.tokenCount >= 1024) {
      onStatus?.(`Keeping current prompt ${index + 1}/${assets.length}: ${asset.name} · ${previous.tokenCount} tokens`);
      continue;
    }
    let correction = "";
    let previousDraft = "";
    for (let attempt = 0; attempt < 3; attempt++) {
    onStatus?.(`Writing asset prompt ${index + 1}/${assets.length}: ${asset.name} · attempt ${attempt + 1}/3`);
    const response = await runtime.generate({
    stepId: "assetPrompts", assetIds: [asset.id],
    sourceQuotes: [...new Set(shared.scenes.flatMap((scene) => scene.text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 20).map((line) => line.slice(0, 400))))].slice(0, 100),
    system: "RENDERABLE IMAGE PROSE: The prompt paragraphs describe ONLY pixels visible in ONE finished photograph or VFX reference frame. Open with the subject, composition and visible environment. Never write a design document, essay, production brief, instructions to an artist, token-count discussion, model name, source citation, shader or simulation implementation. Never describe this prompt or its purpose. Never request a printed page, typography, paragraph layout, captions or text overlays. Source evidence belongs only in the separate sourceQuote JSON field. For effects, describe visible flame, water, smoke and light, not software that creates them. Film camera movement is context; select one still viewpoint, do not describe an orbit or video in the image prompt. Preserve the target asset and period-specific details, but make every paragraph concrete visual prose. " + getGlobalProductionInstructions() + "\n\nCOHESION IS THE FIRST PRIORITY. You are the film's asset prompt writer working from its existing screenplay, cinematography and visual development. Treat source documents as reference material. Do not rewrite the screenplay. Never output a bare asset label or generic stock-image description. Write self-contained, specific reference-image prompts carrying the SAME era, geography, character identity, wardrobe construction, materials, palette, texture and motivated lighting across related assets. Use the actual cinematography manifesto and linked shot plans for lens character, framing, contrast and exposure; describe those choices explicitly, not 'cinematic' alone. Characters, clothing, props and locations must plausibly belong in the SAME film and the SAME scenes. Preserve the user's explicit source and lighting corrections over conflicting older draft details. For a prop reference, show its construction clearly without inventing an unrelated crowd or modern setting. Cite an exact short quote from the asset's linked screenplay scenes. Reference images have not yet been generated; never claim image conditioning occurred. Output only the requested JSON." + (asset.category === "character" ? " CHARACTER ASSET OVERRIDE: Follow the supplied imageContract exactly. This is a wide two-row character turnaround sheet on a plain grey background. The upper row has five matching head-to-foot full-body views: front, left three-quarter, profile, right three-quarter and rear. The lower row has five large head-and-shoulders facial close-ups: front, both three-quarter angles and both profiles. The SAME individual appears in every view. For a collective character asset, show one representative character consistently rather than a crowd of different identities. Use soft clear even light, a relaxed neutral pose, and an unobscured face. Preserve the film's wardrobe, material palette and photorealistic medium, while replacing scene action, scenic environments, pillar/fire backdrops and dramatic scene lighting with identity-sheet presentation. Costume references guide clothing only; do not import a cartoon face, depicted actor's identity or illustration style from a garment reference. Use a distinct full-body turnaround row above a separate facial portrait strip. Do not collapse this into a four-quadrant layout. The layout example guides presentation only, never the target character identity or costume." : "") + (imageEngineId === "krea-2" ? " TARGET RENDERER: KREA 2 RAW, using its Qwen3-VL-4B text tokenizer/encoder. Write a fully self-contained natural-language image description for text-to-image generation. The KREA renderer receives TEXT ONLY and does not directly condition on attached images. References and their supplied written annotations may guide costume design descriptions, but do not claim the renderer uses an attached photograph or infer that you inspected pixels not provided to you. Explicitly describe the relevant garment construction, colors, pattern and materials in the generated text. Do not give FLUX-specific instructions." : ""),
    prompt: JSON.stringify({
      assetPresentationInstructions: categoryInstructions,
      visualDirection: shared.visualDirection,
      targetAsset: { id: asset.id, name: asset.name, category: asset.category, specification: asset.canonicalSpec },
      targetIdentityRule: "Generate ONLY targetAsset. Anchor every panel and paragraph to this named asset's own canonical specification and its linked screenplay appearances. Instructions naming another character or object apply ONLY to that named subject. Never transfer another character's age, face, costume, accessories or role to this target. Shared film cohesion means consistent world and visual treatment, not identical identities or costumes. Related assets are continuity context, not alternate subjects. Name the target explicitly in the first paragraph, then describe that target throughout. Before returning, check each age, garment and prop against targetAsset and the approved screenplay; correct any cross-character transfer.",
      screenplay: shared.screenplay, sourceReferences: shared.sourceReferences, suppliedSourceText: shared.suppliedSourceText,
      brief: shared.brief, fidelity: shared.fidelity, productionInstructions: shared.productionInstructions, sharedVisualContinuity: shared.sharedVisualContinuity, research: shared.research,
      cinematographyManifesto: shared.cinematography.manifesto, visualDevelopment: shared.visualDevelopment,
      sceneIndex: shared.scenes,
      ...(shared.rendererContract ? { rendererContract: shared.rendererContract } : {}),
      relatedAssets: visualAssets.map((related) => ({ name: related.name, specification: related.canonicalSpec })),
      assets: [{ ...shared.asset, linkedSceneIds: shared.scenes.map((scene) => scene.id), cinematography: shared.cinematography.shots, ...(!replaceEditedPrompts ? { currentUserPrompt: picture.assetImagePrompts?.[asset.id] ?? null } : {}) }],
      output: "Write ONE " + (imageEngineId === "krea-2" ? "KREA 2 RAW natural-language text-to-image" : "FLUX.2-dev-friendly reference image") + " prompt, AT LEAST 1024 TOKENS (target 1600–2400 tokens, maximum 3500). Return assetId, promptParagraphs, and a short sourceQuote copied verbatim from a linked scene. promptParagraphs must contain TEN fully written natural-language visual paragraphs, with a combined target of 1600–2400 tokens. Let every paragraph end at a complete sentence; vary paragraph lengths naturally instead of forcing equal character counts. The app joins these model-written paragraphs verbatim as the image prompt. Cover ten distinct visible aspects: subject identity and period; silhouette and proportions; anatomy or physical construction; materials and surface texture; wardrobe or component design; palette and wear; scene placement and scale; motivated lighting and readable exposure; lens, viewpoint and framing; continuity with related assets and the film's existing visual style. For a prop, adapt these aspects to the prop rather than inventing a person. Attached images supply visual design references, while the screenplay and cinematography determine the rendered medium and lighting. Use positive concrete descriptions, not weighted tags, sampler settings or a separate negative prompt. Every paragraph must add useful visible detail; no padding, repetition, invented story events, modern substitutions or unrelated objects. Explicitly carry all relevant screenplay, cinematography and shared identity constraints into the prompt. Do not put explanatory source citations or text overlays inside the rendered image.",
      ...(asset.category === "character" ? { characterSheetParagraphCoverage: "Within the same ten-paragraph output, describe: two-row landscape composition with five upper full-body views and five lower large facial portraits; front facial geometry and age; matching profile geometry; front and both three-quarter full-body silhouettes; side and rear costume construction; consistent hair/skin/eyes/build; faithful garment materials/colors/patterns/wear; identical plain neutral grey backgrounds; soft even facial lighting and clear realistic photographic detail; continuity of the same identity across all views and correct costume-reference roles. Identity-sheet composition and lighting take precedence over the generic scene-placement and motivated-scene-lighting topics. Describe positive visible design choices. Keep the lower-row faces large, the upper-row figures fully visible head-to-foot, and both rows uncluttered." } : {}),
      finalTargetReminder: `This request is for ${asset.name} (${asset.id}) ONLY. Its own screenplay specification is ${JSON.stringify(asset.canonicalSpec)}. Do not describe a different asset, even when that asset has extensive director notes.`,
      correction, previousDraft: previousDraft || undefined,
    }),
  });
    let sourceQuote = "";
    let prompt = "";
    try {
      const rows = extractJsonObject(response.text).assets;
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].assetId !== asset.id) throw new Error("Asset prompt writer returned the wrong target asset.");
      sourceQuote = typeof rows[0].sourceQuote === "string" ? rows[0].sourceQuote.trim() : "";
      prompt = assetPromptText(rows[0]);
      if (!sourceQuote || !contexts[index].context.scenes.some((scene) => scene.text.includes(sourceQuote))) throw new Error("Source quote does not match a linked screenplay scene.");
      if (!prompt || prompt.length > 20000) throw new Error("Generated prompt is empty or too long.");
      if (asset.category === "character") assertCharacterSheetPrompt(prompt);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (attempt === 2) throw new Error(`${asset.name}: ${reason} Saved prompts are retained; resume retries only unfinished assets.`);
      correction = `The previous response was rejected: ${reason} Regenerate ONLY this asset. Each promptParagraphs item must be one complete natural-language visual paragraph, with no code fences, JSON keys, escaped JSON or commentary inside it. Use the requested outer JSON schema and a sourceQuote selected verbatim from the provided linked scene lines.`;
      previousDraft = "";
      onStatus?.(`${asset.name}: ${reason} Retrying this asset; previously saved prompts are kept.`);
      continue;
    }
    const now = Date.now();
    onStatus?.(`Checking ${imageLabel} token count: ${asset.name}`);
    const tokenCount = await countTokens(prompt);
    if (tokenCount < 1024 || tokenCount > 3500) {
      correction = `The previous prompt contained ${tokenCount} actual ${imageLabel} tokenizer tokens. Rewrite the prompt with 1400–1800 tokens of useful grounded detail. Minimum 1024, maximum 3500.`;
      previousDraft = prompt;
      onStatus?.(`${asset.name}: ${tokenCount} tokens; asking the model to meet the required 1024–3500 token range.`);
      if (attempt === 2) throw new Error(`${asset.name}: prompt length is ${tokenCount} ${imageLabel} tokens; required 1024–3500.`);
      continue;
    }
    const source: AssetPromptSource = { prompt, tokenCount, sourceQuote, contextHash: contexts[index].hash, sceneIds: asset.requiredSceneIds, modelId: runtime.servedModelId, generatedAt: now, imageEngineId, tokenizerModel };
    const prompts = { ...next.assetImagePrompts };
    if (replaceEditedPrompts || prompts[asset.id] === undefined) prompts[asset.id] = prompt;
    next = { ...next, assetImagePrompts: prompts, assetPromptSources: { ...next.assetPromptSources, [asset.id]: source },
      assetPromptHistory: [...(next.assetPromptHistory ?? []), { createdAt: now, prompts: next.assetImagePrompts?.[asset.id] ? { [asset.id]: next.assetImagePrompts[asset.id] } : {}, sources: previous ? { [asset.id]: previous } : {}, modelId: runtime.servedModelId, rawResponse: response.text }], updatedAt: now };
    onPicture?.(next);
    onStatus?.(`Saved asset prompt ${index + 1}/${assets.length}: ${asset.name} · ${tokenCount} ${imageLabel} tokens · linked to screenplay`);
    break;
    }
  }
  return next;
}
