import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { makeEmptyResearchBible, seedResearchBibleFromIntake } from "./bible.ts";
import { makePictureIntake } from "../studio/picture-intake.ts";
import {
  RESEARCH_MANUAL_SUMMARY,
  RESEARCH_ROOM_PRIMARY_CTA,
  userFacingResearchModeStrings,
  researchBibleGenerated,
  researchRoomView,
} from "./research-room.ts";

describe("research room has no mode options", () => {
  it("treats an unversioned bible as draft missing and keeps notes secondary", () => {
    const bible = makeEmptyResearchBible(1);
    const view = researchRoomView(bible, true);
    assert.equal(researchBibleGenerated(bible), false);
    assert.equal(view.status, "not-generated");
    assert.equal(view.statusLabel, "Draft missing");
    assert.equal(view.showEmptyState, true);
    assert.equal(view.showManualByDefault, false);
    assert.equal(view.showWorksheetFirst, false);
    assert.equal(view.primaryCta, "Build Research Draft");
    assert.equal(view.manualSummary, "Manual Notes");
    assert.equal(RESEARCH_ROOM_PRIMARY_CTA, "Build Research Draft");
    assert.equal(RESEARCH_MANUAL_SUMMARY, "Manual Notes");
  });

  it("intake-seeded sources without versions are still not a generated bible", () => {
    const intake = { ...makePictureIntake(1), title: "The Last Reel", logline: "An archive answers back." };
    const seeded = seedResearchBibleFromIntake(intake, 2);
    assert.ok(seeded.content.sources.length >= 1);
    assert.equal(researchBibleGenerated(seeded), false);
    assert.equal(researchRoomView(seeded, true).showEmptyState, true);
  });

  it("unavailable model copy does not mention web or local modes", () => {
    const view = researchRoomView(makeEmptyResearchBible(1), false);
    assert.equal(view.showOffline, true);
    assert.equal(view.offlineTitle, "Configured AI model unavailable.");
    assert.equal(view.offlineBody, "Start LM Studio Local API Server and serve a model, then Rescan.");
    assert.equal(userFacingResearchModeStrings(`${view.offlineTitle} ${view.offlineBody} ${view.primaryCta} ${view.manualSummary}`).length, 0);
  });

  it("research workspace has no MODE panel, dropdown, web-assisted, or local option", () => {
    const workspace = readFileSync(new URL("../../components/research/research-workspace.tsx", import.meta.url), "utf8");
    const ledger = readFileSync(new URL("../../components/research/source-ledger-panel.tsx", import.meta.url), "utf8");
    const room = readFileSync(new URL("./research-room.ts", import.meta.url), "utf8");
    const surfaces = `${workspace}\n${ledger}`;
    assert.match(workspace, /Build Research Draft|RESEARCH_ROOM_PRIMARY_CTA/);
    assert.match(workspace, /RESEARCH_MANUAL_SUMMARY/);
    assert.match(workspace, /data-manual-source-entry/);
    assert.match(workspace, /data-research-mode-panel="false"/);
    assert.match(workspace, /No Research Bible has been generated yet/);
    assert.doesNotMatch(workspace, /aria-label="Research mode"/);
    assert.doesNotMatch(workspace, />Mode</);
    assert.doesNotMatch(surfaces, /Web-assisted|web-assisted|Web assisted|web assisted/);
    assert.doesNotMatch(surfaces, /Local Research|Local model research|Local Research Room|Local only|Local \/ user-provided/);
    assert.doesNotMatch(workspace, /<select[\s\S]*Research mode/);
    assert.equal(userFacingResearchModeStrings(surfaces).length, 0);
    assert.match(room, /Build Research Draft/);
    assert.doesNotMatch(room, /Run Local Research Room/);
  });
});
