import {
  PRODUCTION_CATEGORIES,
  type ApprovedScreenplayInput,
  type AssetReadiness,
  type AssetReference,
  type AssetVariant,
  type BreakdownPreflight,
  type BreakdownRequirement,
  type BreakdownRequirementDraft,
  type CanonicalAssetSpec,
  type DependencyEdge,
  type PreparedAssetRecord,
  type PreparationQueueRecord,
  type ProductionAsset,
  type ProductionBreakdown,
  type ProductionCategory,
} from "./types.ts";
import { buildBreakdownSourceBoundary, buildDependencyGraphV2, sourceFingerprint, type BreakdownSourceBoundary } from "./dependency-graph.ts";
import type { PictureResearchBible } from "../research/bible.ts";

export class ScreenplayApprovalRequiredError extends Error {
  constructor() {
    super("Production breakdown requires an approved screenplay version.");
    this.name = "ScreenplayApprovalRequiredError";
  }
}

const CATEGORY_SYNONYMS: Partial<Record<ProductionCategory, Record<string, string>>> = {
  character: { christ: "jesus", "jesus christ": "jesus" },
  prop: { "35mm reel": "film reel", "unlabeled reel": "film reel" },
};

export function normalizeAssetName(name: string, category: ProductionCategory): string {
  const cleaned = name
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(scene|sc)\s*\d+\b/gi, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return CATEGORY_SYNONYMS[category]?.[cleaned] ?? cleaned;
}

export function assertApprovedScreenplay(input: ApprovedScreenplayInput): void {
  if (input.status !== "APPROVED" || !input.versionId || !input.fountain.trim()) {
    throw new ScreenplayApprovalRequiredError();
  }
  const ids = new Set(input.scenes.map((scene) => scene.id));
  if (!input.scenes.length || ids.size !== input.scenes.length || ids.has("")) {
    throw new Error("Approved screenplay scenes require stable, unique IDs.");
  }
}

export function normalizeRequirements(
  drafts: BreakdownRequirementDraft[],
  screenplay: ApprovedScreenplayInput,
): BreakdownRequirement[] {
  const sceneIds = new Set(screenplay.scenes.map((scene) => scene.id));
  const categories = new Set<string>(PRODUCTION_CATEGORIES);
  const seenIds = new Set<string>();
  return drafts.map((draft) => {
    if (!draft.id || seenIds.has(draft.id)) throw new Error(`Duplicate or missing requirement ID: ${draft.id || "(empty)"}`);
    seenIds.add(draft.id);
    if (!categories.has(draft.category)) throw new Error(`Unsupported production category: ${String(draft.category)}`);
    if (draft.confidence && !["A", "B", "C", "D"].includes(draft.confidence)) throw new Error(`Unsupported source confidence: ${String(draft.confidence)}`);
    const linked = [...new Set(draft.sceneIds)].filter((id) => sceneIds.has(id));
    if (!linked.length) throw new Error(`${draft.name} is not linked to an approved screenplay scene.`);
    const normalizedKey = normalizeAssetName(draft.name, draft.category);
    if (!normalizedKey) throw new Error("Breakdown requirements need a usable name.");
    return {
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      sceneIds: linked,
      socialWorldIds: [...new Set(draft.socialWorldIds ?? [])].filter((id) => screenplay.socialWorld.some((entry) => entry.id === id)),
      normalizedKey,
      unnecessary: false,
      stale: false,
      staleReasons: [],
    };
  });
}

function emptySpec(requirement: BreakdownRequirement): CanonicalAssetSpec {
  return {
    identity: requirement.name,
    visualDescription: requirement.description,
    distinguishingFeatures: [],
    prohibitedFeatures: [],
    materials: [],
    setDressing: [],
    continuityLocks: requirement.variantLabel ? [requirement.variantLabel] : [],
    negativeRequirements: [],
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function requirementProvenance(requirement: BreakdownRequirement, screenplayVersionId: string, now: number) {
  return {
    sourceType: "screenplay" as const,
    screenplayVersionId,
    sceneIds: requirement.sceneIds,
    confidence: requirement.confidence,
    evidenceNote: requirement.evidenceNote,
    createdAt: now,
  };
}

export function assetsFromRequirements(
  requirements: BreakdownRequirement[],
  screenplayVersionId: string,
  now = Date.now(),
): ProductionAsset[] {
  const groups = new Map<string, BreakdownRequirement[]>();
  for (const requirement of requirements) {
    const key = `${requirement.category}:${requirement.normalizedKey}`;
    groups.set(key, [...(groups.get(key) ?? []), requirement]);
  }

  return [...groups.entries()].map(([key, items]) => {
    const base = items[0];
    const variants: AssetVariant[] = items
      .filter((item) => Boolean(item.variantLabel))
      .map((item) => ({
        id: `variant:${item.id}`,
        name: item.variantLabel!,
        requiredSceneIds: item.sceneIds,
        requirementIds: [item.id],
        specPatch: { continuityLocks: [item.variantLabel!] },
        stale: false,
        staleReasons: [],
      }));
    const asset: ProductionAsset = {
      id: `asset:${assetIdFromKey(key)}`,
      normalizedKey: key,
      name: base.name,
      aliases: unique(items.map((item) => item.name).filter((name) => name !== base.name)),
      category: base.category,
      hero: items.some((item) => item.hero),
      requirementIds: items.map((item) => item.id),
      requiredSceneIds: unique(items.flatMap((item) => item.sceneIds)),
      socialWorldIds: unique(items.flatMap((item) => item.socialWorldIds ?? [])),
      canonicalSpec: emptySpec(base),
      canonicalApproved: false,
      references: [],
      referenceRequired: items.some((item) => item.referenceRequired),
      variants,
      iterations: [],
      approvedIterationId: null,
      rejectedIterationIds: [],
      specVersions: [],
      approvedSpecVersionId: null,
      aliasesOf: [],
      tombstone: false,
      lineage: [{ id: `lineage:${assetIdFromKey(key)}:created:${now}`, type: "created", at: now, sourceAssetIds: [], targetAssetIds: [`asset:${assetIdFromKey(key)}`], reason: "Requirement extraction" }],
      conflicts: [],
      stale: false,
      staleReasons: [],
      blockedReasons: [],
      provenance: items.map((item) => requirementProvenance(item, screenplayVersionId, now)),
      readiness: "NOT_PREPARED",
      updatedAt: now,
    };
    return { ...asset, readiness: calculateReadiness(asset) };
  });
}

function assetIdFromKey(key: string): string {
  return key.replace(/[^a-z0-9]+/g, ":").replace(/^:|:$/g, "");
}

export function calculateReadiness(asset: ProductionAsset): AssetReadiness {
  if (asset.tombstone) return "STALE";
  if (asset.stale || asset.variants.some((variant) => variant.stale)) return "STALE";
  if ((asset.conflicts ?? []).some((conflict) => !conflict.resolved && conflict.severity === "blocker")) return "BLOCKED";
  if (asset.blockedReasons.length) return "BLOCKED";
  if ((asset as { preparedApproved?: boolean }).preparedApproved) return "APPROVED_PREPARED";
  if (asset.approvedSpecVersionId || asset.canonicalApproved) {
    if (asset.referenceRequired && !asset.references.length) return "BLOCKED";
    return "READY_TO_PREPARE";
  }
  if ((asset.specVersions ?? []).some((version) => !version.approved)) return "READY_FOR_REVIEW";
  if (asset.iterations.some((iteration) => iteration.status === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  if (asset.iterations.some((iteration) => iteration.status === "GENERATED")) return "GENERATED";
  if (asset.iterations.length && asset.iterations.every((iteration) => iteration.status === "REJECTED")) return "REJECTED";
  if (asset.referenceRequired && !asset.references.length) return "BLOCKED";
  if (!asset.canonicalApproved) return asset.canonicalSpec.visualDescription.trim() ? "PREPARING" : "NOT_PREPARED";
  return "READY_TO_PREPARE";
}

export function buildDependencyGraph(record: Pick<ProductionBreakdown, "screenplayVersionId" | "requirements" | "assets">): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (const requirement of record.requirements) {
    for (const sceneId of requirement.sceneIds) {
      edges.push({ fromType: "screenplay-version", fromId: record.screenplayVersionId, toType: "scene", toId: sceneId });
      edges.push({ fromType: "scene", fromId: sceneId, toType: "requirement", toId: requirement.id });
    }
  }
  for (const asset of record.assets) {
    for (const requirementId of asset.requirementIds) {
      edges.push({ fromType: "requirement", fromId: requirementId, toType: "asset", toId: asset.id });
    }
    for (const variant of asset.variants) {
      edges.push({ fromType: "asset", fromId: asset.id, toType: "variant", toId: variant.id });
      edges.push({ fromType: "variant", fromId: variant.id, toType: "generation-spec", toId: `spec:${variant.id}` });
    }
    if (!asset.variants.length) edges.push({ fromType: "asset", fromId: asset.id, toType: "generation-spec", toId: `spec:${asset.id}` });
    for (const iteration of asset.iterations) {
      edges.push({ fromType: "generation-spec", fromId: `spec:${iteration.variantId ?? asset.id}`, toType: "iteration", toId: iteration.id });
      if (iteration.id === asset.approvedIterationId) edges.push({ fromType: "iteration", fromId: iteration.id, toType: "approved-asset", toId: asset.id });
    }
  }
  return edges.filter((edge, index) => edges.findIndex((other) => JSON.stringify(other) === JSON.stringify(edge)) === index);
}

export function createProductionBreakdown(
  screenplay: ApprovedScreenplayInput,
  drafts: BreakdownRequirementDraft[],
  now = Date.now(),
  sourceBoundary: BreakdownSourceBoundary | null = null,
): ProductionBreakdown {
  assertApprovedScreenplay(screenplay);
  const requirements = normalizeRequirements(drafts, screenplay);
  const assets = assetsFromRequirements(requirements, screenplay.versionId, now);
  const record: ProductionBreakdown = {
    schemaVersion: 1,
    pictureId: screenplay.pictureId,
    screenplayVersionId: screenplay.versionId,
    scenes: screenplay.scenes,
    socialWorld: screenplay.socialWorld,
    sourceContext: screenplay.sourceContext,
    requirements,
    assets,
    dependencies: [],
    graph: null,
    sourceBoundary,
    inventoryVersion: 1,
    approvals: [],
    auditLog: [],
    preparedAssets: [],
    queue: [],
    createdAt: now,
    updatedAt: now,
  };
  return { ...record, dependencies: buildDependencyGraph(record), graph: buildDependencyGraphV2(record, now) };
}

export function createResearchAwareProductionBreakdown(input: { screenplay: import("../studio/screenplay.ts").ApprovedScreenplayBoundary; research: PictureResearchBible; drafts: BreakdownRequirementDraft[]; now?: number }): ProductionBreakdown | { error: string } {
  const now = input.now ?? Date.now();
  const boundary = buildBreakdownSourceBoundary(input.screenplay, input.research, now);
  if ("error" in boundary) return boundary;
  const approvedInput: ApprovedScreenplayInput = {
    pictureId: input.screenplay.pictureId,
    versionId: input.screenplay.screenplayVersionId,
    status: "APPROVED",
    fountain: input.screenplay.fountain,
    scenes: input.screenplay.scenes.map((scene) => ({ id: scene.id, slugline: scene.slugline })),
    socialWorld: input.screenplay.historicalContext?.socialWorld.map((entry) => ({
      id: entry.id,
      expectedBehavior: entry.expectedBehavior,
      violationOrReversal: entry.violationOrReversal,
      whoWouldNotice: entry.whoWouldNotice,
      visibleReaction: entry.visibleReaction,
      statusHonorImplication: entry.socialConsequence,
      confidence: entry.historicalConfidence,
      evidenceNote: entry.evidenceNote,
      sceneIds: [],
    })) ?? [],
    sourceContext: {
      workflow: input.screenplay.provenance.workflow,
      sourceType: input.screenplay.provenance.sourceType,
      sourceVersionId: input.screenplay.provenance.sourceVersionId,
      screenplayModelId: input.screenplay.provenance.model?.servedModelId ?? null,
      confidenceLegend: input.screenplay.historicalContext?.confidenceLegend ?? {},
      sourceReferences: input.screenplay.historicalContext?.sourceReferences ?? "",
      fidelityRequirements: input.screenplay.historicalContext?.fidelityRequirements ?? "",
      adaptationBoundaries: input.screenplay.historicalContext?.adaptationBoundaries ?? "",
    },
  };
  return createProductionBreakdown(approvedInput, input.drafts, now, boundary);
}

export function reconcileProductionBreakdown(
  previous: ProductionBreakdown,
  extracted: ProductionBreakdown,
  now = Date.now(),
): ProductionBreakdown {
  if (previous.pictureId !== extracted.pictureId) throw new Error("Production breakdowns must belong to the same picture.");
  const oldScenes = new Map(previous.scenes.map((scene) => [scene.id, scene.slugline.trim().toLocaleUpperCase()]));
  const newScenes = new Map(extracted.scenes.map((scene) => [scene.slugline.trim().toLocaleUpperCase(), scene.id]));
  const remapScenes = (ids: string[]) => unique(ids.map((id) => newScenes.get(oldScenes.get(id) ?? "") ?? ""));
  const oldById = new Map(previous.assets.map((asset) => [asset.id, asset]));
  const oldByIdentity = new Map(previous.assets.map((asset) => [asset.normalizedKey, asset]));
  const retainedIds = new Set<string>();

  const assets = extracted.assets.map((fresh) => {
    const old = oldById.get(fresh.id) ?? oldByIdentity.get(fresh.normalizedKey);
    if (!old) return fresh;
    retainedIds.add(old.id);
    const oldSceneNames = unique(old.requiredSceneIds.map((id) => oldScenes.get(id) ?? "")).sort();
    const newSceneNames = unique(fresh.requiredSceneIds.map((id) => extracted.scenes.find((scene) => scene.id === id)?.slugline.trim().toLocaleUpperCase() ?? "")).sort();
    const dependencyChanged = JSON.stringify(oldSceneNames) !== JSON.stringify(newSceneNames);
    const variants = fresh.variants.map((variant) => {
      const prior = old.variants.find((item) => item.id === variant.id || item.name.toLocaleLowerCase() === variant.name.toLocaleLowerCase());
      return prior ? {
        ...variant,
        specPatch: prior.specPatch,
        stale: prior.stale || dependencyChanged,
        staleReasons: dependencyChanged ? unique([...prior.staleReasons, "Dependent screenplay scenes changed."]) : prior.staleReasons,
      } : variant;
    });
    const merged: ProductionAsset = {
      ...fresh,
      name: old.name,
      category: old.category,
      hero: old.hero,
      aliases: unique([...fresh.aliases, ...old.aliases]),
      canonicalSpec: old.canonicalSpec,
      canonicalApproved: old.canonicalApproved,
      references: old.references,
      referenceRequired: old.referenceRequired,
      variants,
      iterations: old.iterations,
      approvedIterationId: old.approvedIterationId,
      rejectedIterationIds: old.rejectedIterationIds,
      specVersions: old.specVersions ?? [],
      approvedSpecVersionId: old.approvedSpecVersionId ?? null,
      aliasesOf: old.aliasesOf ?? [],
      tombstone: old.tombstone ?? false,
      lineage: old.lineage ?? [],
      conflicts: old.conflicts ?? [],
      stale: old.stale || dependencyChanged,
      staleReasons: dependencyChanged ? unique([...old.staleReasons, "Dependent screenplay scenes changed."]) : old.staleReasons,
      blockedReasons: old.blockedReasons,
      provenance: [...old.provenance, ...fresh.provenance],
      updatedAt: now,
    };
    return { ...merged, readiness: calculateReadiness(merged) };
  });

  const removedAssets = previous.assets.filter((asset) => !retainedIds.has(asset.id)).map((asset) => {
    const stale: ProductionAsset = {
      ...asset,
      requiredSceneIds: remapScenes(asset.requiredSceneIds),
      stale: true,
      staleReasons: unique([...asset.staleReasons, "No longer detected in the approved screenplay."]),
      updatedAt: now,
    };
    return { ...stale, readiness: calculateReadiness(stale) };
  });
  const nextRequirementIds = new Set(extracted.requirements.map((item) => item.id));
  const removedRequirements = previous.requirements.filter((item) => !nextRequirementIds.has(item.id)).map((item) => ({
    ...item,
    sceneIds: remapScenes(item.sceneIds),
    stale: true,
    staleReasons: unique([...item.staleReasons, "No longer detected in the approved screenplay."]),
  }));
  const next: ProductionBreakdown = {
    ...extracted,
    requirements: [...extracted.requirements, ...removedRequirements],
    assets: [...assets, ...removedAssets],
    preparedAssets: (previous.preparedAssets ?? []).map((prepared) => ({ ...prepared, status: "BLOCKED" as const, blockers: unique([...prepared.blockers, "Approved screenplay or breakdown changed; refresh prepared asset record before generation."]), approvedAt: null })),
    createdAt: previous.createdAt,
    updatedAt: now,
  };
  const withDependencies = { ...next, dependencies: buildDependencyGraph(next), graph: buildDependencyGraphV2(next, now) };
  return previous.queue.length ? prepareAssetQueue(withDependencies, now) : withDependencies;
}

function refresh(record: ProductionBreakdown, assets: ProductionAsset[], now: number): ProductionBreakdown {
  const refreshed = assets.map((asset) => ({ ...asset, readiness: calculateReadiness(asset), updatedAt: now }));
  const next = { ...record, assets: refreshed, updatedAt: now };
  const withDependencies = { ...next, dependencies: buildDependencyGraph(next), graph: buildDependencyGraphV2(next, now) };
  return record.queue.length ? prepareAssetQueue(withDependencies, now) : withDependencies;
}

export function editAsset(
  record: ProductionBreakdown,
  assetId: string,
  patch: Partial<Pick<ProductionAsset, "name" | "category" | "hero" | "canonicalSpec" | "referenceRequired" | "blockedReasons">>,
  now = Date.now(),
): ProductionBreakdown {
  return refresh(record, record.assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    const category = patch.category ?? asset.category;
    const name = patch.name?.trim() || asset.name;
    const currentVersions = asset.specVersions ?? [];
    const approvedVersionId = asset.approvedSpecVersionId ?? (asset.canonicalApproved ? `spec:${asset.id}:approved:legacy` : null);
    const frozenApproved = approvedVersionId && !currentVersions.some((version) => version.id === approvedVersionId)
      ? [{ id: approvedVersionId, assetId: asset.id, createdAt: asset.updatedAt, sourceVersionId: null, spec: structuredClone(asset.canonicalSpec), approved: true, provenance: asset.provenance }]
      : [];
    const canonicalSpec = { ...asset.canonicalSpec, ...patch.canonicalSpec };
    const draftVersion = { id: `spec:${asset.id}:${now}`, assetId: asset.id, createdAt: now, sourceVersionId: approvedVersionId, spec: structuredClone(canonicalSpec), approved: false, provenance: asset.provenance };
    return {
      ...asset,
      ...patch,
      name,
      category,
      normalizedKey: `${category}:${normalizeAssetName(name, category)}`,
      canonicalSpec,
      canonicalApproved: false,
      approvedSpecVersionId: null,
      specVersions: [...frozenApproved, ...currentVersions, draftVersion],
      lineage: [...(asset.lineage ?? []), { id: `lineage:edited:${asset.id}:${now}`, type: "edited", at: now, sourceAssetIds: [asset.id], targetAssetIds: [asset.id], reason: "Asset spec edited" }],
    };
  }), now);
}

export function addMissingAsset(
  record: ProductionBreakdown,
  input: {
    assetId: string;
    requirementId: string;
    name: string;
    category: ProductionCategory;
    description: string;
    sceneIds: string[];
    hero?: boolean;
    referenceRequired?: boolean;
  },
  now = Date.now(),
): ProductionBreakdown {
  if (record.assets.some((asset) => asset.id === input.assetId) || record.requirements.some((item) => item.id === input.requirementId)) {
    throw new Error("Manual asset and requirement IDs must be unique.");
  }
  const sceneSet = new Set(record.scenes.map((scene) => scene.id));
  const linkedScenes = unique(input.sceneIds).filter((id) => sceneSet.has(id));
  if (!linkedScenes.length) throw new Error("A manual asset must link to at least one approved screenplay scene.");
  const requirement: BreakdownRequirement = {
    id: input.requirementId,
    category: input.category,
    name: input.name.trim(),
    description: input.description.trim(),
    sceneIds: linkedScenes,
    hero: input.hero,
    referenceRequired: input.referenceRequired,
    socialWorldIds: [],
    normalizedKey: normalizeAssetName(input.name, input.category),
    unnecessary: false,
    stale: false,
    staleReasons: [],
  };
  const generated = assetsFromRequirements([requirement], record.screenplayVersionId, now)[0];
  const asset: ProductionAsset = {
    ...generated,
    id: input.assetId,
    normalizedKey: `${input.category}:${requirement.normalizedKey}`,
    provenance: [{
      sourceType: "user",
      screenplayVersionId: record.screenplayVersionId,
      sceneIds: linkedScenes,
      createdAt: now,
    }],
  };
  return refresh({ ...record, requirements: [...record.requirements, requirement] }, [...record.assets, asset], now);
}

export function approveCanonicalSpec(record: ProductionBreakdown, assetId: string, now = Date.now()): ProductionBreakdown {
  return refresh(record, record.assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    const draft = [...(asset.specVersions ?? [])].reverse().find((version) => !version.approved)
      ?? { id: `spec:${asset.id}:${now}`, assetId: asset.id, createdAt: now, sourceVersionId: asset.approvedSpecVersionId ?? null, spec: structuredClone(asset.canonicalSpec), approved: false, provenance: asset.provenance };
    const approved = { ...draft, spec: structuredClone(draft.spec), approved: true };
    const specVersions = [...(asset.specVersions ?? []).filter((version) => version.id !== draft.id), approved];
    return {
      ...asset,
      canonicalSpec: structuredClone(approved.spec),
      specVersions,
      canonicalApproved: true,
      approvedSpecVersionId: approved.id,
      stale: false,
      staleReasons: [],
      lineage: [...(asset.lineage ?? []), { id: `lineage:approved-spec:${asset.id}:${now}`, type: "approved-spec", at: now, sourceAssetIds: [asset.id], targetAssetIds: [asset.id], reason: "Canonical asset spec approved" }],
    };
  }), now);
}

export function addAssetVariant(record: ProductionBreakdown, assetId: string, variant: AssetVariant, now = Date.now()): ProductionBreakdown {
  return refresh(record, record.assets.map((asset) => asset.id === assetId && !asset.variants.some((item) => item.id === variant.id)
    ? { ...asset, variants: [...asset.variants, variant], requiredSceneIds: unique([...asset.requiredSceneIds, ...variant.requiredSceneIds]) }
    : asset), now);
}

export function removeAssetVariant(record: ProductionBreakdown, assetId: string, variantId: string, now = Date.now()): ProductionBreakdown {
  return refresh(record, record.assets.map((asset) => asset.id === assetId ? { ...asset, variants: asset.variants.filter((item) => item.id !== variantId) } : asset), now);
}

export function attachReference(record: ProductionBreakdown, assetId: string, reference: AssetReference, now = Date.now()): ProductionBreakdown {
  return refresh(record, record.assets.map((asset) => asset.id === assetId
    ? { ...asset, references: [...asset.references.filter((item) => item.id !== reference.id).map((item) => reference.preferred ? { ...item, preferred: false } : item), reference] }
    : asset), now);
}

export function setPreferredReference(record: ProductionBreakdown, assetId: string, referenceId: string, now = Date.now()): ProductionBreakdown {
  return refresh(record, record.assets.map((asset) => asset.id === assetId
    ? { ...asset, references: asset.references.map((item) => ({ ...item, preferred: item.id === referenceId })) }
    : asset), now);
}

export function markRequirementUnnecessary(record: ProductionBreakdown, requirementId: string, unnecessary = true, now = Date.now()): ProductionBreakdown {
  const requirements = record.requirements.map((item) => item.id === requirementId ? { ...item, unnecessary } : item);
  const assets = record.assets
    .map((asset) => ({ ...asset, requirementIds: asset.requirementIds.filter((id) => id !== requirementId) }))
    .filter((asset) => asset.requirementIds.length);
  return refresh({ ...record, requirements }, assets, now);
}

export function mergeAssets(record: ProductionBreakdown, targetId: string, sourceIds: string[], now = Date.now()): ProductionBreakdown {
  const sourceSet = new Set(sourceIds.filter((id) => id !== targetId));
  const target = record.assets.find((asset) => asset.id === targetId);
  const sources = record.assets.filter((asset) => sourceSet.has(asset.id));
  if (!target || !sources.length) return record;
  if (sources.some((asset) => asset.category !== target.category)) throw new Error("Change asset categories before merging across categories.");
  const merged: ProductionAsset = {
    ...target,
    aliases: unique([...target.aliases, ...sources.flatMap((asset) => [asset.name, ...asset.aliases])]),
    hero: target.hero || sources.some((asset) => asset.hero),
    requirementIds: unique([...target.requirementIds, ...sources.flatMap((asset) => asset.requirementIds)]),
    requiredSceneIds: unique([...target.requiredSceneIds, ...sources.flatMap((asset) => asset.requiredSceneIds)]),
    socialWorldIds: unique([...target.socialWorldIds, ...sources.flatMap((asset) => asset.socialWorldIds)]),
    variants: [...target.variants, ...sources.flatMap((asset) => asset.variants)].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index),
    references: [...target.references, ...sources.flatMap((asset) => asset.references)].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index),
    provenance: [...target.provenance, ...sources.flatMap((asset) => asset.provenance)],
    referenceRequired: target.referenceRequired || sources.some((asset) => asset.referenceRequired),
  };
  return refresh(record, record.assets.filter((asset) => !sourceSet.has(asset.id)).map((asset) => asset.id === targetId ? merged : asset), now);
}

export function splitAsset(
  record: ProductionBreakdown,
  assetId: string,
  input: { id: string; name: string; category?: ProductionCategory; requirementIds: string[] },
  now = Date.now(),
): ProductionBreakdown {
  const source = record.assets.find((asset) => asset.id === assetId);
  if (!source) return record;
  const move = new Set(input.requirementIds.filter((id) => source.requirementIds.includes(id)));
  if (!move.size || move.size === source.requirementIds.length) throw new Error("A split must leave requirements on both assets.");
  const movedRequirements = record.requirements.filter((item) => move.has(item.id));
  const category = input.category ?? source.category;
  const clone: ProductionAsset = {
    ...source,
    id: input.id,
    name: input.name.trim(),
    category,
    normalizedKey: `${category}:${normalizeAssetName(input.name, category)}`,
    aliases: [],
    requirementIds: [...move],
    requiredSceneIds: unique(movedRequirements.flatMap((item) => item.sceneIds)),
    variants: source.variants.filter((variant) => variant.requirementIds.some((id) => move.has(id))),
    references: [],
    iterations: [],
    approvedIterationId: null,
    rejectedIterationIds: [],
    canonicalApproved: false,
    provenance: movedRequirements.map((item) => requirementProvenance(item, record.screenplayVersionId, now)),
    updatedAt: now,
  };
  const remainder = {
    ...source,
    requirementIds: source.requirementIds.filter((id) => !move.has(id)),
    requiredSceneIds: unique(record.requirements.filter((item) => source.requirementIds.includes(item.id) && !move.has(item.id)).flatMap((item) => item.sceneIds)),
    variants: source.variants.filter((variant) => variant.requirementIds.some((id) => !move.has(id))),
  };
  return refresh(record, record.assets.map((asset) => asset.id === assetId ? remainder : asset).concat(clone), now);
}

export function invalidateSceneDependents(
  record: ProductionBreakdown,
  nextScreenplay: ApprovedScreenplayInput,
  changedSceneIds: string[],
  now = Date.now(),
): ProductionBreakdown {
  assertApprovedScreenplay(nextScreenplay);
  const changed = new Set(changedSceneIds);
  const requirements = record.requirements.map((requirement) => requirement.sceneIds.some((id) => changed.has(id))
    ? { ...requirement, stale: true, staleReasons: unique([...requirement.staleReasons, "Source screenplay scene changed."]) }
    : requirement);
  const assets = record.assets.map((asset) => {
    const variants = asset.variants.map((variant) => variant.requiredSceneIds.some((id) => changed.has(id))
      ? { ...variant, stale: true, staleReasons: unique([...variant.staleReasons, "Dependent screenplay scene changed."]) }
      : variant);
    const directlyAffected = asset.requiredSceneIds.some((id) => changed.has(id)) && !asset.variants.some((variant) => variant.requiredSceneIds.some((id) => changed.has(id)));
    return directlyAffected
      ? { ...asset, variants, stale: true, staleReasons: unique([...asset.staleReasons, "Dependent screenplay scene changed."]) }
      : { ...asset, variants };
  });
  return refresh({ ...record, requirements, screenplayVersionId: nextScreenplay.versionId, scenes: nextScreenplay.scenes, socialWorld: nextScreenplay.socialWorld, sourceContext: nextScreenplay.sourceContext, queue: record.queue.map((item) => {
    const asset = assets.find((candidate) => candidate.id === item.assetId);
    const variant = asset?.variants.find((candidate) => candidate.id === item.variantId);
    return asset?.stale || variant?.stale ? { ...item, status: "PLANNED" as const, updatedAt: now } : item;
  }) }, assets, now);
}

function queueStatus(asset: ProductionAsset): PreparationQueueRecord["status"] {
  if (asset.referenceRequired && !asset.references.length) return "WAITING_FOR_REFERENCE";
  if (asset.readiness === "BLOCKED" || asset.readiness === "STALE") return "BLOCKED";
  if (asset.readiness === "READY_TO_GENERATE" || asset.readiness === "READY_TO_PREPARE" || asset.readiness === "APPROVED_SPEC") return "READY";
  if (asset.readiness === "APPROVED_PREPARED") return "APPROVED_PREPARED";
  if (asset.canonicalApproved) return "PREFLIGHTED";
  return "PLANNED";
}

export function prepareAssetQueue(record: ProductionBreakdown, now = Date.now()): ProductionBreakdown {
  const queue: PreparationQueueRecord[] = record.assets.flatMap((asset) => {
    const variants = asset.variants.length ? asset.variants.map((variant) => variant.id) : [null];
    return variants.map((variantId) => ({
      id: `prep:${asset.id}:${variantId ?? "base"}`,
      assetId: asset.id,
      variantId,
      status: queueStatus(asset),
      promptIngredients: unique([
        asset.canonicalSpec.identity,
        asset.canonicalSpec.visualDescription,
        asset.canonicalSpec.visualStyle ?? "",
        asset.canonicalSpec.period ?? "",
        ...asset.canonicalSpec.continuityLocks,
      ]),
      negativeRequirements: unique([...asset.canonicalSpec.prohibitedFeatures, ...asset.canonicalSpec.negativeRequirements]),
      referenceIds: asset.references.map((reference) => reference.id),
      dependencyIds: variantId ? [asset.id, variantId, ...asset.requirementIds] : [asset.id, ...asset.requirementIds],
      createdAt: record.queue.find((item) => item.assetId === asset.id && item.variantId === variantId)?.createdAt ?? now,
      updatedAt: now,
    }));
  });
  const next = { ...record, queue, updatedAt: now };
  return { ...next, graph: buildDependencyGraphV2(next, now) };
}

export function breakdownPreflight(record: ProductionBreakdown): BreakdownPreflight {
  const byCategory = Object.fromEntries(PRODUCTION_CATEGORIES.map((category) => [category, 0])) as BreakdownPreflight["byCategory"];
  const states: AssetReadiness[] = ["NOT_PREPARED", "PREPARING", "READY_FOR_REVIEW", "APPROVED_SPEC", "READY_TO_PREPARE", "APPROVED_PREPARED", "READY_TO_GENERATE", "GENERATED", "NEEDS_REVIEW", "APPROVED", "REJECTED", "STALE", "BLOCKED"];
  const byReadiness = Object.fromEntries(states.map((state) => [state, 0])) as BreakdownPreflight["byReadiness"];
  for (const asset of record.assets) {
    byCategory[asset.category] += 1;
    byReadiness[asset.readiness] += 1;
  }
  return {
    total: record.assets.length,
    byCategory,
    byReadiness,
    ready: byReadiness.READY_TO_GENERATE + byReadiness.READY_TO_PREPARE + byReadiness.APPROVED_SPEC + byReadiness.APPROVED_PREPARED + byReadiness.GENERATED + byReadiness.APPROVED,
    needReview: byReadiness.PREPARING + byReadiness.READY_FOR_REVIEW + byReadiness.NEEDS_REVIEW + byReadiness.STALE,
    blocked: byReadiness.BLOCKED,
  };
}
