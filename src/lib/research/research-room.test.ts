import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { makeEmptyResearchBible, seedResearchBibleFromIntake } from "./bible.ts";
import { makePictureIntake } from "../studio/picture-intake.ts";
import {
  RESEARCH_MANUAL_SUMMARY,
  RESEARCH_ROOM_PRIMARY_CTA,
  researchBibleGenerated,
  researchRoomView,
} from "./research-room.ts";

describe("research room is not manual-first", () => {
  it("treats an unversioned bible as not generated and keeps manual entry secondary", () => {
    const bible = makeEmptyResearchBible(1);
    const view = researchRoomView(bible, true);
    assert.equal(researchBibleGenerated(bible), false);
    assert.equal(view.status, "not-generated");
    assert.equal(view.showEmptyState, true);
    assert.equal(view.showManualByDefault, false);
    assert.equal(view.showWorksheetFirst, false);
    assert.equal(view.primaryCta, RESEARCH_ROOM_PRIMARY_CTA);
    assert.equal(view.manualSummary, RESEARCH_MANUAL_SUMMARY);
    assert.deepEqual(view.emptySections, [
      "Source / Canon Ledger",
      "World Overview",
      "Characters",
      "Locations",
      "Visual Identity",
      "Cinematography",
      "Risks",
    ]);
  });

  it("intake-seeded sources without versions are still not a generated bible", () => {
    const intake = { ...makePictureIntake(1), title: "The Last Reel", logline: "An archive answers back." };
    const seeded = seedResearchBibleFromIntake(intake, 2);
    assert.ok(seeded.content.sources.length >= 1);
    assert.equal(researchBibleGenerated(seeded), false);
    assert.equal(researchRoomView(seeded, true).showEmptyState, true);
  });

  it("offline model uses a blocked/offline state instead of a manual worksheet", () => {
    const view = researchRoomView(makeEmptyResearchBible(1), false);
    assert.equal(view.showOffline, true);
    assert.equal(view.showWorksheetFirst, false);
    assert.equal(view.showManualByDefault, false);
    assert.match(view.offlineTitle, /unavailable/i);
    assert.match(view.offlineBody, /LM Studio/);
    assert.equal(view.primaryCta, RESEARCH_ROOM_PRIMARY_CTA);
  });

  it("research workspace primary CTA is the research room, with manual form collapsed", () => {
    const workspace = readFileSync(new URL("../../components/research/research-workspace.tsx", import.meta.url), "utf8");
    assert.match(workspace, /Run Local Research Room|RESEARCH_ROOM_PRIMARY_CTA/);
    assert.match(workspace, /RESEARCH_MANUAL_SUMMARY/);
    assert.match(workspace, /data-manual-source-entry/);
    assert.match(workspace, /No Research Bible has been generated yet/);
    assert.doesNotMatch(workspace, /02 · Research/);
  });
});
