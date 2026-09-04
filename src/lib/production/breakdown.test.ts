import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addAssetVariant,
  addMissingAsset,
  approveCanonicalSpec,
  attachReference,
  breakdownPreflight,
  calculateReadiness,
  createProductionBreakdown,
  editAsset,
  invalidateSceneDependents,
  markRequirementUnnecessary,
  mergeAssets,
  prepareAssetQueue,
  reconcileProductionBreakdown,
  setPreferredReference,
  splitAsset,
} from "./breakdown.ts";
import { migrateLegacyPictureToProduction } from "./legacy-migration.ts";
import { inventoryCards } from "./inventory.ts";
import { runProductionBreakdown } from "./extraction.ts";
import { deterministicFountainBreakdown, deterministicFountainExtractor } from "./deterministic-extractor.ts";
import { parseProductionBreakdowns, sanitizeProductionBreakdown, serializeProductionBreakdowns } from "./persistence.ts";
import { approvedScreenplayInputFromBoundary } from "./screenplay-adapter.ts";
import type { ApprovedScreenplayInput, AssetReference, BreakdownRequirementDraft } from "./types.ts";

function screenplay(status: ApprovedScreenplayInput["status"] = "APPROVED", versionId = "screenplay-v1"): ApprovedScreenplayInput {
  return {
    pictureId: "picture-1",
    versionId,
    status,
    fountain: "INT. COURTYARD - DAY\n\nJESUS enters.\n\nEXT. ROAD - NIGHT\n\nMOSES walks.",
    scenes: [
      { id: "scene-1", slugline: "INT. COURTYARD - DAY" },
      { id: "scene-2", slugline: "EXT. ROAD - NIGHT" },
    ],
    socialWorld: [{
      id: "social-1",
      expectedBehavior: "A teacher avoids the outcast.",
      violationOrReversal: "He approaches openly.",
      whoWouldNotice: "The household and neighbors.",
      visibleReaction: "A guarded silence.",
      statusHonorImplication: "He risks public standing.",
      confidence: "B",
      evidenceNote: "Strong social-historical evidence.",
      sceneIds: ["scene-1"],
    }],
  };
}

function requirements(): BreakdownRequirementDraft[] {
  return [
    { id: "req-jesus-1", category: "character", name: "Jesus Scene 1", description: "Teacher in his early thirties", sceneIds: ["scene-1"], confidence: "A", socialWorldIds: ["social-1"] },
    { id: "req-jesus-2", category: "character", name: "Jesus Scene 2", description: "The same man on the road", sceneIds: ["scene-2"], variantLabel: "travel-worn robe", confidence: "C" },
    { id: "req-moses", category: "character", name: "Moses", description: "Older prophet", sceneIds: ["scene-2"], referenceRequired: true },
    { id: "req-court", category: "location", name: "The Courtyard", description: "Limestone domestic court", sceneIds: ["scene-1"], confidence: "B" },
    { id: "req-road", category: "location", name: "Road", description: "Dust road outside the settlement", sceneIds: ["scene-2"] },
    { id: "req-prop", category: "prop", name: "Clay water jar", description: "Period domestic vessel", sceneIds: ["scene-1"], hero: true },
  ];
}

function record() {
  return createProductionBreakdown(screenplay(), requirements(), 100);
}

describe("approved screenplay gate and extraction normalization", () => {
  it("rejects canonical breakdown for an unapproved screenplay", () => {
    assert.throws(() => createProductionBreakdown(screenplay("READY_FOR_REVIEW"), requirements()), /approved screenplay/i);
  });

  it("normalizes extracted requirements, links scenes, and deduplicates identity variants", () => {
    const result = record();
    assert.equal(result.requirements.length, 6);
    assert.equal(result.assets.length, 5);
    const jesus = result.assets.find((asset) => asset.name === "Jesus Scene 1")!;
    assert.deepEqual(jesus.requiredSceneIds.sort(), ["scene-1", "scene-2"]);
    assert.equal(jesus.variants.length, 1);
    assert.equal(jesus.variants[0].name, "travel-worn robe");
    assert.deepEqual(jesus.socialWorldIds, ["social-1"]);
  });

  it("refuses extracted elements without stable screenplay scene linkage", () => {
    assert.throws(() => createProductionBreakdown(screenplay(), [{ ...requirements()[0], sceneIds: ["missing"] }]), /not linked/i);
  });

  it("runs an injected extraction adapter only after approval", async () => {
    let calls = 0;
    const extractor = { extract: async () => { calls += 1; return requirements(); } };
    await assert.rejects(() => runProductionBreakdown(screenplay("DRAFT"), extractor), /approved screenplay/i);
    assert.equal(calls, 0);
    const result = await runProductionBreakdown(screenplay(), extractor, 120);
    assert.equal(calls, 1);
    assert.equal(result.assets.length, 5);
  });

  it("extracts a useful deterministic offline baseline with stable scene links", async () => {
    const input: ApprovedScreenplayInput = {
      ...screenplay(),
      fountain: [
        "INT. STEENBECK ROOM - NIGHT",
        "",
        "ELIAS VOSS",
        "The unlabeled film reel is still warm.",
        "",
        "He threads the reel through the humming motor. Rain needles the glass.",
        "",
        "EXT. COASTAL ARCHIVE - DAWN",
        "",
        "ELIAS VOSS (V.O.)",
        "The bell means the storm is over.",
        "",
        "His wool coat is soaked and torn.",
      ].join("\n"),
      scenes: [
        { id: "scene-1", slugline: "INT. STEENBECK ROOM - NIGHT" },
        { id: "scene-2", slugline: "EXT. COASTAL ARCHIVE - DAWN" },
      ],
    };
    const drafts = deterministicFountainBreakdown({ screenplayVersionId: input.versionId, fountain: input.fountain, scenes: input.scenes, socialWorld: [] });
    assert.ok(drafts.some((item) => item.category === "location" && item.name === "Steenbeck Room" && item.variantLabel === "night"));
    assert.deepEqual(drafts.find((item) => item.category === "character" && item.name === "Elias Voss")?.sceneIds, ["scene-1", "scene-2"]);
    assert.ok(drafts.some((item) => item.category === "voice" && item.name === "Elias Voss Voice"));
    assert.ok(drafts.some((item) => item.category === "prop" && item.name === "Film Reel" && item.hero));
    assert.ok(drafts.some((item) => item.category === "wardrobe" && item.name === "Coat"));
    assert.ok(drafts.some((item) => item.category === "sound" && item.name === "Mechanical Hum"));
    assert.ok(drafts.some((item) => item.category === "continuity" && item.name === "Wet Continuity"));
    assert.equal(drafts.every((item) => item.sceneIds.length > 0), true);

    const first = await runProductionBreakdown(input, deterministicFountainExtractor, 125);
    const second = await runProductionBreakdown(input, deterministicFountainExtractor, 125);
    assert.deepEqual(first, second);
  });

  it("keeps the deterministic extractor provider- and generation-independent", () => {
    const source = deterministicFountainBreakdown.toString();
    assert.doesNotMatch(source, /xai|grok|comfy|fetch\(|generate/i);
  });
});

describe("canonical assets and user corrections", () => {
  it("keeps canonical specs engine-independent and editable", () => {
    const jesus = record().assets.find((asset) => asset.category === "character")!;
    const result = editAsset(record(), jesus.id, {
      name: "Jesus",
      canonicalSpec: {
        ...jesus.canonicalSpec,
        age: "early thirties",
        facialGeometry: "long oval face",
        wardrobe: "undyed wool tunic",
        period: "early first century",
        continuityLocks: ["stable face", "undyed base tunic"],
        prohibitedFeatures: ["modern fasteners"],
      },
    });
    const edited = result.assets.find((asset) => asset.id === jesus.id)!;
    assert.equal(edited.name, "Jesus");
    assert.equal(edited.canonicalSpec.period, "early first century");
    assert.doesNotMatch(JSON.stringify(edited.canonicalSpec), /flux|comfy|workflow json/i);
  });

  it("supports category changes, canonical approval, and readiness calculation", () => {
    const initial = record();
    const prop = initial.assets.find((asset) => asset.category === "prop")!;
    const recategorized = editAsset(initial, prop.id, { category: "set_dressing" });
    assert.equal(recategorized.assets.find((asset) => asset.id === prop.id)?.category, "set_dressing");
    const approved = approveCanonicalSpec(recategorized, prop.id);
    assert.equal(approved.assets.find((asset) => asset.id === prop.id)?.readiness, "READY_TO_PREPARE");
  });

  it("distinguishes generated work from work awaiting review", () => {
    const base = record();
    const prop = base.assets.find((asset) => asset.category === "prop")!;
    const withIteration = {
      ...prop,
      iterations: [{
          id: "iteration-1",
          variantId: null,
          mediaUri: "asset://iteration-1",
          createdAt: 230,
          status: "GENERATED" as const,
          provenance: { sourceType: "user" as const, screenplayVersionId: base.screenplayVersionId, sceneIds: prop.requiredSceneIds, createdAt: 230 },
        }],
    };
    assert.equal(calculateReadiness(withIteration), "GENERATED");
    assert.equal(calculateReadiness({ ...withIteration, iterations: withIteration.iterations.map((item) => ({ ...item, status: "NEEDS_REVIEW" as const })) }), "NEEDS_REVIEW");
  });

  it("adds variants and merges then splits user-corrected assets", () => {
    let current = record();
    const court = current.assets.find((asset) => asset.name === "The Courtyard")!;
    current = addAssetVariant(current, court.id, {
      id: "variant-rain",
      name: "after rain",
      requiredSceneIds: ["scene-1"],
      requirementIds: ["req-court"],
      specPatch: { weather: "after rain" },
      stale: false,
      staleReasons: [],
    });
    assert.equal(current.assets.find((asset) => asset.id === court.id)?.variants.length, 1);

    const road = current.assets.find((asset) => asset.name === "Road")!;
    current = editAsset(current, road.id, { name: "Courtyard annex" });
    current = mergeAssets(current, court.id, [road.id]);
    assert.equal(current.assets.length, 4);
    assert.deepEqual(current.assets.find((asset) => asset.id === court.id)?.requirementIds.sort(), ["req-court", "req-road"]);

    current = splitAsset(current, court.id, { id: "asset-road-split", name: "Road", requirementIds: ["req-road"] });
    assert.equal(current.assets.length, 5);
    assert.deepEqual(current.assets.find((asset) => asset.id === "asset-road-split")?.requiredSceneIds, ["scene-2"]);
  });

  it("attaches references and preserves exactly one preferred reference", () => {
    const base = record();
    const moses = base.assets.find((asset) => asset.name === "Moses")!;
    const ref = (id: string, preferred: boolean): AssetReference => ({
      id,
      name: `${id}.jpg`,
      uri: `asset://${id}`,
      mediaType: "image/jpeg",
      preferred,
      uploadedAt: 200,
      provenance: { sourceType: "user", screenplayVersionId: base.screenplayVersionId, sceneIds: ["scene-2"], createdAt: 200 },
    });
    let next = attachReference(base, moses.id, ref("ref-1", true));
    next = attachReference(next, moses.id, ref("ref-2", false));
    next = setPreferredReference(next, moses.id, "ref-2");
    const refs = next.assets.find((asset) => asset.id === moses.id)!.references;
    assert.deepEqual(refs.map((item) => [item.id, item.preferred]), [["ref-1", false], ["ref-2", true]]);
  });

  it("marks unnecessary requirements without deleting the audit record", () => {
    const next = markRequirementUnnecessary(record(), "req-prop");
    assert.equal(next.requirements.find((item) => item.id === "req-prop")?.unnecessary, true);
    assert.equal(next.assets.some((asset) => asset.requirementIds.includes("req-prop")), false);
  });

  it("adds a missing user-authored asset with source-scene provenance", () => {
    const next = addMissingAsset(record(), {
      assetId: "asset-donkey",
      requirementId: "req-donkey",
      name: "Pack donkey",
      category: "creature",
      description: "Small working animal with a woven pack blanket.",
      sceneIds: ["scene-2"],
    }, 240);
    const donkey = next.assets.find((asset) => asset.id === "asset-donkey")!;
    assert.equal(donkey.category, "creature");
    assert.deepEqual(donkey.requiredSceneIds, ["scene-2"]);
    assert.equal(donkey.provenance[0].sourceType, "user");
  });
});

describe("dependency staleness and evidence", () => {
  it("invalidates only variants and assets that depend on changed scenes", () => {
    const base = record();
    const changed = invalidateSceneDependents(base, screenplay("APPROVED", "screenplay-v2"), ["scene-2"]);
    const jesus = changed.assets.find((asset) => asset.normalizedKey.endsWith(":jesus"))!;
    const court = changed.assets.find((asset) => asset.name === "The Courtyard")!;
    assert.equal(jesus.stale, false);
    assert.equal(jesus.variants[0].stale, true);
    assert.equal(court.stale, false);
    assert.equal(changed.assets.find((asset) => asset.name === "Moses")?.stale, true);
    assert.equal(changed.requirements.find((item) => item.id === "req-moses")?.stale, true);
    assert.equal(changed.requirements.find((item) => item.id === "req-court")?.stale, false);
    assert.equal(changed.screenplayVersionId, "screenplay-v2");
  });

  it("preserves A-D source confidence and social-world behavior metadata", () => {
    const result = record();
    assert.equal(result.requirements.find((item) => item.id === "req-jesus-1")?.confidence, "A");
    assert.equal(result.requirements.find((item) => item.id === "req-jesus-2")?.confidence, "C");
    assert.equal(result.socialWorld[0].confidence, "B");
    assert.equal(result.socialWorld[0].visibleReaction, "A guarded silence.");
    assert.match(result.socialWorld[0].statusHonorImplication, /standing/);
  });

  it("adapts the approved screenplay worker boundary without importing its store", () => {
    const input = approvedScreenplayInputFromBoundary({
      schemaVersion: 1,
      pictureId: "p",
      screenplayVersionId: "v2",
      approvedAt: 10,
      fountain: "INT. ROOM - DAY",
      scenes: [{ id: "s", slugline: "INT. ROOM - DAY", sourceLine: 1, screenplayVersionId: "v2" }],
      provenance: { workflow: "biblical-7-pass", sourceType: "biblical-historical", sourceVersionId: "v1", model: null },
      historicalContext: {
        confidenceLegend: { A: "explicit", B: "strong", C: "reconstruction", D: "disputed" },
        socialWorld: [{ id: "sw", expectedBehavior: "expected", violationOrReversal: "reversed", whoWouldNotice: "elders", visibleReaction: "silence", socialConsequence: "honor risk", historicalConfidence: "D", evidenceNote: "disputed" }],
        sourceReferences: "Source passage",
        fidelityRequirements: "Keep distinctions",
        adaptationBoundaries: "Do not assert disputed tradition",
      },
    });
    assert.equal(input.status, "APPROVED");
    assert.equal(input.versionId, "v2");
    assert.equal(input.socialWorld[0].confidence, "D");
    assert.equal(input.sourceContext?.sourceReferences, "Source passage");
  });

  it("reconciles a new approved version without discarding reviewed assets", () => {
    const base = record();
    const prop = base.assets.find((asset) => asset.category === "prop")!;
    const reviewed = approveCanonicalSpec(editAsset(base, prop.id, {
      canonicalSpec: { ...prop.canonicalSpec, visualDescription: "User-approved hero jar specification." },
    }), prop.id);
    const nextInput = screenplay("APPROVED", "screenplay-v2");
    const nextRequirements = requirements().filter((item) => item.id !== "req-moses").map((item) => ({
      ...item,
      sceneIds: item.sceneIds,
    }));
    const extracted = createProductionBreakdown(nextInput, nextRequirements, 400);
    const reconciled = reconcileProductionBreakdown(reviewed, extracted, 410);
    const preserved = reconciled.assets.find((asset) => asset.id === prop.id)!;
    const removed = reconciled.assets.find((asset) => asset.name === "Moses")!;
    assert.equal(reconciled.screenplayVersionId, "screenplay-v2");
    assert.equal(preserved.canonicalSpec.visualDescription, "User-approved hero jar specification.");
    assert.equal(preserved.canonicalApproved, true);
    assert.ok(preserved.specVersions?.length);
    assert.equal(preserved.approvedSpecVersionId?.startsWith(`spec:${prop.id}:`), true);
    assert.equal(reconciled.graph?.nodes.some((node) => node.id === `asset:${prop.id}`), true);
    assert.equal(preserved.stale, false);
    assert.equal(removed.stale, true);
    assert.match(removed.staleReasons.join(" "), /no longer detected/i);
  });
});

describe("preparation queue, preflight, and persistence", () => {
  it("prepares engine-independent queue records and never starts generation", () => {
    let next = record();
    for (const asset of next.assets) {
      if (!asset.referenceRequired) next = approveCanonicalSpec(next, asset.id);
    }
    next = prepareAssetQueue(next, 300);
    assert.ok(next.queue.length >= next.assets.length);
    assert.equal(next.queue.some((item) => (item.status as string) === "RUNNING"), false);
    assert.equal(next.assets.every((asset) => asset.iterations.length === 0), true);
    assert.equal(next.queue.find((item) => item.assetId === next.assets.find((asset) => asset.name === "Moses")?.id)?.status, "WAITING_FOR_REFERENCE");
    assert.equal(next.queue.some((item) => item.status === "READY"), true);
    const readyAsset = next.assets.find((asset) => asset.readiness === "READY_TO_PREPARE")!;
    const edited = editAsset(next, readyAsset.id, { canonicalSpec: { ...readyAsset.canonicalSpec, visualDescription: "Revised canonical description" } }, 310);
    assert.ok(edited.queue.find((item) => item.assetId === readyAsset.id)?.promptIngredients.includes("Revised canonical description"));
  });

  it("summarizes clickable category/readiness counts", () => {
    let next = record();
    const prop = next.assets.find((asset) => asset.category === "prop")!;
    next = approveCanonicalSpec(next, prop.id);
    const summary = breakdownPreflight(next);
    assert.equal(summary.total, 5);
    assert.equal(summary.byCategory.character, 2);
    assert.equal(summary.ready, 1);
    assert.equal(summary.blocked, 1);
  });

  it("builds filterable inventory card models with missing/readiness labels", () => {
    const cards = inventoryCards(record(), { category: "character", readiness: "all", query: "moses" });
    assert.equal(cards.length, 1);
    assert.equal(cards[0].name, "Moses");
    assert.equal(cards[0].readinessLabel, "BLOCKED");
    const missing = inventoryCards(record(), { category: "location", readiness: "all", query: "court" });
    assert.equal(missing[0].readinessLabel, "PREPARING");
    assert.match(missing[0].sceneLabels[0], /COURTYARD/);
  });

  it("round-trips the complete breakdown for close/reopen persistence", () => {
    const approved = approveCanonicalSpec(record(), record().assets[0].id, 301);
    const prepared = prepareAssetQueue({ ...approved, assets: approved.assets.map((asset, index) => index === 0 ? { ...asset, preparedApproved: true, readiness: "APPROVED_PREPARED" as const } : asset) });
    const restored = parseProductionBreakdowns(serializeProductionBreakdowns([prepared]));
    assert.deepEqual(restored, JSON.parse(JSON.stringify([{ ...prepared, productionAuthority: null }])));
    assert.equal(restored[0]!.queue.some((item) => item.status === "APPROVED_PREPARED"), true);
    assert.deepEqual(parseProductionBreakdowns("broken"), []);
    const unsafe = JSON.parse(serializeProductionBreakdowns([prepared]));
    unsafe.records[0].queue.push({ id: "bad", assetId: "asset-1", variantId: null, status: "RUNNING" });
    assert.equal(parseProductionBreakdowns(JSON.stringify(unsafe))[0].queue.some((item) => (item.status as string) === "RUNNING"), false);
    assert.equal(sanitizeProductionBreakdown(undefined), null);
    assert.equal(sanitizeProductionBreakdown({ schemaVersion: 1 }), null);
    assert.deepEqual(sanitizeProductionBreakdown(prepared), { ...prepared, productionAuthority: null });
  });

  it("migrates The Last Reel into canonical production records", () => {
    const legacy = {
      id: "pic_last_reel",
      title: "The Last Reel",
      screenplayFountain: "EXT. COASTAL ARCHIVE — NIGHT\n\nINT. STEENBECK ROOM — NIGHT",
      updatedAt: 1,
      scenes: [{ id: "sc1", slugline: "EXT. COASTAL ARCHIVE — NIGHT", summary: "Rain on the pier." }],
      characters: [{ id: "ch1", name: "Elias Voss", role: "Conservator", age: "late 40s", look: "Tired precise hands." }],
      locations: [{ id: "loc1", name: "Coastal archive", description: "Cedar and steel on a working pier.", lighting: "Sodium practicals" }],
      props: [{ id: "pr1", name: "Unlabeled 35mm reel", description: "Warm stock on a metal core." }],
      wardrobe: [{ id: "w1", name: "Elias night shift", description: "Wool cardigan and rolled sleeves." }],
      vfx: [{ id: "v1", name: "Hood bloom", description: "The projection holds too long." }],
      voices: [{ id: "vo1", character: "Elias Voss", text: "No leader. No slate." }],
      cues: [{ id: "cue1", name: "Pier rain", mood: "lonely", instruments: "prepared piano", sfx: "rain and gulls" }],
    };
    const migrated = migrateLegacyPictureToProduction(legacy, 500);
    assert.equal(migrated.pictureId, "pic_last_reel");
    assert.ok(migrated.assets.some((asset) => asset.name === "Elias Voss" && asset.category === "character"));
    assert.ok(migrated.assets.some((asset) => asset.name === "Coastal archive" && asset.category === "location"));
    assert.ok(migrated.assets.some((asset) => asset.category === "music"));
    assert.ok(migrated.assets.some((asset) => asset.category === "sound"));
    assert.equal(migrated.assets.every((asset) => asset.provenance.every((entry) => entry.sourceType === "legacy-migration")), true);
    assert.equal(migrated.queue.length, 0);
  });
});
