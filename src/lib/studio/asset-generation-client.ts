import type { Picture } from "./types.ts";
import { approveInventoryAssetSpec, prepareAssetRecords, applyProductionAuthority, applyPreparedApproval, appendGeneratedIteration } from "../production/index.ts";
import { releaseMoviePlanWriterForImages, writeAssetPromptsOnServer, findAssetReferencesOnServer } from "./movie-plan-client.ts";
import { runtimeDefaults } from "./engine-controls.ts";
import { approveVisualRecord } from "../visual-development.ts";
import { approveCinematographyPlan } from "../cinematography.ts";
import { selectAssetEngine } from "./asset-engine-selection.ts";
import { isVisualAsset, requireGroundedAssetPrompt } from "./asset-prompt-context.ts";
import { countAssetPromptTokens } from "./movie-plan-api.ts";
import { stableHash } from "../production/dependency-graph.ts";
import type { PreparedAssetRecord, ProductionAsset } from "../production/types.ts";

export { isVisualAsset } from "./asset-prompt-context.ts";

function samePreparedInputs(left: PreparedAssetRecord, right: PreparedAssetRecord) {
  const inputs = ({ assetId, variantId, specVersionId, visualBibleVersionIds, cinematographyPlanIds, blockers, promptIngredients, negativeRequirements, referenceIds, dependencyFingerprints }: PreparedAssetRecord) =>
    ({ assetId, variantId, specVersionId, visualBibleVersionIds, cinematographyPlanIds, blockers, promptIngredients, negativeRequirements, referenceIds, dependencyFingerprints });
  return stableHash(inputs(left)) === stableHash(inputs(right));
}

export function hasCurrentImage(asset: ProductionAsset, engineId: string, prompt: string) {
  if (asset.iterations.some(iteration => iteration.uploadedFileName && iteration.mediaUri && iteration.status !== "REJECTED")) return true;
  const dimensions = assetImageDimensions(asset, engineId);
  return asset.iterations.some((iteration) => {
    if (!iteration.mediaUri || iteration.status === "REJECTED" || iteration.execution?.engineId !== engineId || iteration.execution.prompt !== prompt) return false;
    if (iteration.width !== dimensions.width || iteration.height !== dimensions.height) return false;
    if (engineId === "krea-2" && (iteration.execution.conditioningMode !== "text-only" || iteration.execution.references.length)) return false;
    const references = engineId === "krea-2" ? iteration.execution.promptReferences ?? [] : iteration.execution.references ?? [];
    return references.length === asset.references.length && asset.references.every((reference) => references.some((executed) => {
      const expectedHash = reference.uri.match(/(?:reference-([a-f0-9]{64})|\.([a-f0-9]{24}))\.png$/)?.slice(1).find(Boolean);
      return executed.id === reference.uri && Boolean(expectedHash && executed.fingerprint?.startsWith(expectedHash));
    }));
  });
}

export function assetImageDimensions(asset: Pick<ProductionAsset, "category">, engineId: string): { width: number; height: number } {
  if (asset.category === "character" && engineId === "krea-2") return { width: 1536, height: 1024 };
  if (asset.category === "character" && engineId === "flux2") return { width: 1024, height: 1024 };
  return { width: 512, height: 512 };
}

export async function generateAssetDrafts(picture: Picture, onPicture: (picture: Picture) => void, onProgress: (message: string) => void, onlyAssetId?: string, regenerateOutdated = false) {
  const api = window.premiere316?.image;
  if (!api || !picture.production) throw new Error("A completed movie plan in Premiere316 is required.");
  if (!picture.assetPromptSources && !picture.assetImagePrompts) {
    picture = await findAssetReferencesOnServer(picture, onProgress, onPicture);
    onProgress("The local model is writing asset prompts from the screenplay and cinematography…");
    picture = await writeAssetPromptsOnServer(picture, undefined, false, onPicture);
    onPicture(picture);
  }
  let next = picture;
  let record = picture.production!;
  if (!picture.productFlow?.reviewInternalPhases) {
    let visual = picture.visualDevelopment;
    if (visual) {
      for (const [kind, rows] of [["board", visual.boards], ["character", visual.characterBibles], ["wardrobe", visual.wardrobeStates], ["location", visual.locationBibles], ["prop", visual.propBibles]] as const) {
        for (const row of rows) if (row.status !== "APPROVED") visual = approveVisualRecord(visual, kind, row.id);
      }
    }
    let cinema = picture.cinematography;
    if (cinema) for (const plan of cinema.shotPlans) if (plan.status !== "APPROVED") cinema = approveCinematographyPlan(cinema, plan.id);
    next = { ...next, visualDevelopment: visual, cinematography: cinema };
  }
  const publish = () => { next = { ...next, production: record, updatedAt: Date.now() }; onPicture(next); };
  if (record.productionAuthority?.authorityId && ["CURRENT", "INVALID"].includes(record.productionAuthority.status)) {
    const live = await api.authorityStatus({ pictureId: picture.id });
    if (live.ok && live.status === "CURRENT" && live.authorityId === record.productionAuthority.authorityId && live.digest === record.productionAuthority.digest) {
      const requests = record.assets.filter((asset) => isVisualAsset(asset) && (!onlyAssetId || asset.id === onlyAssetId)).flatMap((asset) => {
        const prepared = record.preparedAssets?.find((item) => item.assetId === asset.id && item.status === "APPROVED_PREPARED" && item.preparedApprovalRootId);
        if (!prepared) return [];
        return [{ preparedAssetId: prepared.id, preparedApprovalRootId: prepared.preparedApprovalRootId!, engineId: picture.selectedEngine.image, prompt: requireGroundedAssetPrompt(next, asset), referenceUris: asset.references.map((reference) => reference.uri), knownIterationIds: asset.iterations.map((iteration) => iteration.id) }];
      });
      if (requests.length) {
        onProgress("Checking for completed images saved before the app lost its response…");
        const recovery = await api.recoverDrafts({ pictureId: picture.id, authorityId: record.productionAuthority.authorityId!, rawCanonical: record, requests });
        if (!recovery.ok) throw new Error(recovery.error);
        if (recovery.authority && record.productionAuthority.status !== "CURRENT") {
          record = applyProductionAuthority(record, recovery.authority);
          for (const approval of recovery.approvals ?? []) record = applyPreparedApproval(record, { ...approval, authorityId: recovery.authority.authorityId });
          publish();
        }
        for (const result of recovery.results) {
          record = appendGeneratedIteration(record, { preparedAssetId: result.preparedAssetId, iterationId: result.iterationId, output: { ...result.output, mediaBytes: new Uint8Array(result.output.mediaBytes), sidecarBytes: new Uint8Array(result.output.sidecarBytes) }, provenance: result.provenance, continuityFindings: result.continuityFindings, receiptDigest: result.receiptDigest });
          publish();
          onProgress(`Recovered saved image: ${record.assets.find((asset) => asset.id === result.provenance.assetId)?.name ?? "asset"}. Its signed receipt and image files were verified.`);
        }
      }
    }
  }
  const assets = record.assets.filter((asset) => {
    if (!isVisualAsset(asset) || onlyAssetId && asset.id !== onlyAssetId) return false;
    const prompt = requireGroundedAssetPrompt(next, asset);
    return onlyAssetId || (regenerateOutdated ? !hasCurrentImage(asset, picture.selectedEngine.image, prompt) : !asset.iterations.some((iteration) => iteration.mediaUri));
  });
  if (!assets.length) {
    onProgress("All selected asset images are current. Review the images or regenerate an individual asset.");
    return next;
  }
  // Validate the entire saved queue before releasing its writer or beginning GPU work.
  const prompts = new Map<string, string>();
  for (const [index, asset] of assets.entries()) {
    onProgress(`Checking saved prompt ${index + 1}/${assets.length}: ${asset.name}`);
    const prompt = requireGroundedAssetPrompt(next, asset);
    const { count } = await countAssetPromptTokens({ data: { prompt, engineId: picture.selectedEngine.image } });
    if (count < 1024 || count > 3500) throw new Error(`${asset.name}: edited prompt has ${count} image-encoder tokens; required 1024–3500.`);
    prompts.set(asset.id, prompt);
  }
  publish();
  onProgress(`${prompts.size} asset prompts saved and validated. Preparing their attached references…`);
  let freshRecord = record;
  for (const asset of freshRecord.assets.filter(isVisualAsset)) if (!asset.approvedSpecVersionId) freshRecord = approveInventoryAssetSpec(freshRecord, asset.id);
  freshRecord = prepareAssetRecords(freshRecord, next.visualDevelopment?.approvals.map((a) => a.id) ?? [], next.cinematography?.approvals.map((a) => a.id) ?? []);
  const live = await api.authorityStatus({ pictureId: picture.id });
  const current = record.productionAuthority?.status === "CURRENT" && live.ok && live.status === "CURRENT" && live.authorityId === record.productionAuthority.authorityId && live.digest === record.productionAuthority.digest;
  const inputsCurrent = freshRecord.preparedAssets?.length === record.preparedAssets?.length && freshRecord.preparedAssets?.every((fresh) => {
    const previous = record.preparedAssets?.find((item) => item.id === fresh.id);
    return previous && samePreparedInputs(previous, fresh);
  });
  const targetsApproved = assets.every((asset) => record.preparedAssets?.some((item) => item.assetId === asset.id && item.status === "APPROVED_PREPARED" && item.productionAuthorityId === record.productionAuthority?.authorityId));
  if (!current || !inputsCurrent || !targetsApproved) {
    onProgress("Sealing current asset specifications and attached reference images…");
    record = freshRecord;
    const ready = record.preparedAssets?.filter((item) => item.status === "READY_TO_PREPARE") ?? [];
    if (!ready.length) throw new Error(record.preparedAssets?.[0]?.blockers.join(" ") || "No visual assets can be generated.");
    const prepared = await api.prepareDrafts({ pictureId: picture.id, rawCanonical: record });
    if (!prepared.ok) throw new Error(prepared.error);
    record = applyProductionAuthority(record, prepared.authority);
    for (const approval of prepared.approvals) record = applyPreparedApproval(record, { ...approval, authorityId: prepared.authority.authorityId });
    publish();
  }
  for (const asset of assets) requireGroundedAssetPrompt(next, record.assets.find((item) => item.id === asset.id)!);
  const writerIds = [...new Set(assets.map((asset) => picture.assetPromptSources?.[asset.id]?.modelId || picture.productFlow?.servedModelId).filter((id): id is string => Boolean(id)))];
  for (const writerId of writerIds) {
    onProgress(`All ${prompts.size} prompts are queued. Offloading ${writerId} to free GPU memory for the image renderer…`);
    const released = await releaseMoviePlanWriterForImages(writerId);
    if (!released?.released) throw new Error("Writer offload was not confirmed. Image generation has not started.");
  }
  onProgress("Writer offload confirmed. Checking the local asset image renderer…");
  const manifests = await api.manifests();
  const engine = selectAssetEngine(picture.selectedEngine.image, manifests);
  if (!engine?.controls) throw new Error("Local asset image renderer is unavailable.");
  const controls = engine.controls;
  const valuesByAsset = new Map(assets.map((asset, index) => [asset.id, { ...runtimeDefaults(controls), ...assetImageDimensions(asset, engine.adapterId), seed: (Date.now() + index) % 2147483647, precision: "BF16", outputFormat: "PNG", outputBitDepth: 8 }]));
  if (engine.adapterId === "krea-2") {
    onProgress(`Encoding all ${prompts.size} saved prompts on GPU before loading KREA 2 RAW…`);
    const unsubscribe = api.onProgress?.((event) => {
      if (event.pictureId === picture.id && event.assetId === "prompt-batch" && event.preparedAssetId === "prompt-batch") onProgress(event.message);
    });
    try {
      const batch = assets.map((asset) => {
        const prepared = record.preparedAssets!.find((item) => item.assetId === asset.id);
        if (!prepared?.preparedApprovalRootId || prepared.status !== "APPROVED_PREPARED") throw new Error(`${asset.name}: prepared approval is missing.`);
        return { preparedAssetId: prepared.id, preparedApprovalRootId: prepared.preparedApprovalRootId, prompt: prompts.get(asset.id)!, values: valuesByAsset.get(asset.id)! };
      });
      const encoded = await api.encodeDraftPrompts({ pictureId: picture.id, authorityId: record.productionAuthority!.authorityId!, engineId: engine.adapterId, prompts: batch });
      if (!encoded.ok) throw new Error(encoded.error);
      if (encoded.promptCount !== batch.length || !encoded.encoderReleased || encoded.textEncoderDevice !== "cuda") throw new Error("The image worker did not confirm the complete GPU prompt queue and encoder release.");
      onProgress(`${encoded.promptCount} prompts encoded. Text encoder offloaded; starting KREA 2 RAW image generation.`);
    } finally { unsubscribe?.(); }
  }
  for (const [index, asset] of assets.entries()) {
    onProgress(`Generating asset image ${index + 1}/${assets.length}: ${asset.name}`);
    const prepared = record.preparedAssets!.find((item) => item.assetId === asset.id);
    if (!prepared || prepared.status !== "APPROVED_PREPARED") throw new Error(`${asset.name}: ${prepared?.blockers.join(" ") || "Not prepared."}`);
    const prompt = prompts.get(asset.id)!;
    const result = await (async () => {
      const unsubscribe = api.onProgress?.((event) => {
        if (event.pictureId === picture.id && event.assetId === asset.id && event.preparedAssetId === prepared.id) onProgress(`${asset.name}: ${event.message}`);
      });
      try {
        return await api.generateDraft({ authorityId: record.productionAuthority!.authorityId!, preparedAssetId: prepared.id, preparedApprovalRootId: prepared.preparedApprovalRootId!, engineId: engine.adapterId, engineName: engine.modelVariant,
          promptOverride: prompt, values: valuesByAsset.get(asset.id)! });
      } finally { unsubscribe?.(); }
    })();
    if (!result.ok) throw new Error(`${asset.name}: ${result.error}`);
    record = appendGeneratedIteration(record, { preparedAssetId: prepared.id, iterationId: result.iterationId!, output: { ...result.output, mediaBytes: new Uint8Array(result.output.mediaBytes), sidecarBytes: new Uint8Array(result.output.sidecarBytes) }, provenance: result.provenance, continuityFindings: result.continuityFindings, receiptDigest: result.receiptDigest });
    publish();
  }
  onProgress("Asset images generated. Review the images, edit prompts or regenerate, then approve.");
  return next;
}
