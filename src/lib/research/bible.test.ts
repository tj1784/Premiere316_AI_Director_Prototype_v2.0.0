import assert from "node:assert/strict";
import test from "node:test";
import { makePictureIntake } from "../studio/picture-intake.ts";
import { approveResearchBible, emptyResearchSections, hydratePictureResearch, makeEmptyResearchBible, RESEARCH_BIBLE_SECTION_KEYS, researchBlocksScreenplay, researchSectionsLookPlaceholder, saveResearchDraft, seedResearchBibleFromIntake } from "./bible.ts";
import { startDeltaResearch } from "./delta-research.ts";
import { addResearchSource } from "./source-ledger.ts";

test("missing research hydrates without wiping intake text", () => {
  const intake = { ...makePictureIntake(1), title: "The Last Reel", premise: "An archive answers back.", logline: "An archive answers back." };
  const bible = hydratePictureResearch(null, intake, 2);
  assert.equal(bible.schemaVersion, 1);
  assert.equal(bible.status, "DRAFT");
  assert.equal(intake.logline, "An archive answers back.");
  assert.ok(bible.content.sources.length >= 1);
});

test("class A source without locator is rejected", () => {
  const added = addResearchSource([], {
    id: "src:1",
    title: "Canon",
    locator: "",
    quote: "In the beginning",
    confidence: "A",
    importedFrom: null,
    createdAt: 1,
  });
  assert.equal("error" in added, true);
});

test("approve then delta keeps the approved version row", () => {
  const intake = { ...makePictureIntake(1), title: "Still Water", premise: "A bell." };
  const seeded = seedResearchBibleFromIntake(intake, 1);
  const saved = saveResearchDraft(seeded, seeded.content, "v-draft", 2);
  if ("error" in saved) throw new Error(saved.error);
  const approved = approveResearchBible(saved, "v-approved", 3);
  if ("error" in approved) throw new Error(approved.error);
  assert.equal(researchBlocksScreenplay(approved), null);
  const delta = startDeltaResearch(approved, { ...approved.content, notes: `${approved.content.notes}\nDelta note` }, "v-delta", 4);
  assert.equal(delta.status, "DELTA_PENDING");
  assert.ok(delta.versions.some((version) => version.id === "v-approved"));
  assert.equal(delta.approvedVersionId, "v-approved");
});

test("placeholder Generated section text is rejected", () => {
  const placeholder = emptyResearchSections();
  for (const key of RESEARCH_BIBLE_SECTION_KEYS) placeholder[key] = `Generated ${key} for Xenogears.`;
  assert.equal(researchSectionsLookPlaceholder(placeholder), true);
  const unique = emptyResearchSections();
  unique.sourceCanonLedger = "Squaresoft 1998 Xenogears is the canon ledger.";
  unique.worldOverview = "Ignas is a photoreal continent of mountain villages.";
  unique.characters = "Fei Fong Wong is a painter who witnesses rather than speeches.";
  unique.locations = "Lahan studio at dusk; Ignas plain at night.";
  unique.storyTheme = "Recognition without lecture in a two-minute trailer.";
  unique.audienceContext = "Fans and strangers who only need faces, smoke, and restraint.";
  unique.visualIdentity = "Photoreal 35mm, tungsten practicals, rain on glass.";
  unique.productionDesign = "Worn linen, oil-stained wood, a burning canvas.";
  unique.costumeProps = "Paint-stiff jacket, campaign coat, unlabeled canvas.";
  unique.cinematographyResearch = "Hold faces past comfort. Static until the gear steps.";
  unique.soundMusicWorld = "Dry studio air, distant raid thunder, restrained strings.";
  unique.risksDisputes = "Fan-work must not claim official canon.";
  unique.aiProductionFeasibility = "Stills and editorial assembly are feasible locally.";
  unique.confidenceLedger = "A: named Xenogears characters. B: photoreal brief.";
  assert.equal(researchSectionsLookPlaceholder(unique), false);
});

test("web-assisted mode does not create a network field", () => {
  const bible = makeEmptyResearchBible(1);
  bible.content.mode = "web-assisted-opt-in";
  assert.equal(bible.content.mode, "web-assisted-opt-in");
  assert.equal("endpoint" in bible.content, false);
});
