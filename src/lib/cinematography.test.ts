import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approveCinematographyPlan, cinematographyApprovalBlockers, hydrateCinematographyState, runCinematographyQa, seedCinematographyFromPicture } from "./cinematography.ts";

function picture() {
  return {
    id: "pic",
    tone: "restrained tungsten noir",
    research: null,
    acts: [{ number: 1, name: "Archive" }],
    scenes: [{ id: "sc1", act: 1, slugline: "INT. ROOM - NIGHT", summary: "", emotionalBeat: "", durationSec: 10 }],
    shots: [
      { id: "sh1", sceneId: "sc1", index: 1, type: "establishing", description: "wide room", durationSec: 8, camera: "wide", lens: "35mm", cameraMove: "static", emotion: "dread", expression: "still", t2iPrompt: "", i2vPrompt: "", t2voicePrompt: "" },
      { id: "sh2", sceneId: "sc1", index: 2, type: "closeup", description: "face", durationSec: 8, camera: "close", lens: "85mm", cameraMove: "slow push", emotion: "dread", expression: "still", t2iPrompt: "", i2vPrompt: "", t2voicePrompt: "" },
    ],
  };
}

describe("Cinematography domain", () => {
  it("seeds manifesto, sequence arcs and shot plans without media generation", () => {
    const state = seedCinematographyFromPicture(picture(), 30);
    assert.equal(state.manifestoVersions.length, 1);
    assert.equal(state.sequenceArcs.length > 0, true);
    assert.equal(state.shotPlans.length, picture().shots.length);
  });

  it("deterministic QA flags geography drift and does not rewrite plans", () => {
    const state = seedCinematographyFromPicture(picture(), 31);
    const bad = { ...state, shotPlans: state.shotPlans.map((plan, index) => index === 0 ? { ...plan, geography: "" } : plan) };
    const report = runCinematographyQa(bad, undefined, 32);
    assert.equal(report.planUnchanged, true);
    assert.equal(report.findings.some((finding) => finding.category === "GEOGRAPHY_DRIFT"), true);
  });

  it("approves shot plans append-only and hydrates idempotently", () => {
    const state = seedCinematographyFromPicture(picture(), 33);
    const approved = approveCinematographyPlan(state, state.shotPlans[0]!.id, 34);
    assert.equal(approved.shotPlans[0]!.status, "APPROVED");
    assert.equal(approved.approvals.length, 1);
    const hydrated = hydrateCinematographyState(approved, picture(), 35);
    assert.equal(hydrated.shotPlans[0]!.id, approved.shotPlans[0]!.id);
  });

  it("uses stable seed IDs across additive hydration and blocks approval with QA blockers", () => {
    const first = seedCinematographyFromPicture(picture(), 40);
    const second = seedCinematographyFromPicture(picture(), 99);
    assert.equal(first.manifestoVersions[0]!.id, second.manifestoVersions[0]!.id);
    assert.equal(first.qaReports[0]!.id, second.qaReports[0]!.id);
    const bad = { ...first, shotPlans: first.shotPlans.map((plan, index) => index === 0 ? { ...plan, geography: "" } : plan) };
    const qa = runCinematographyQa(bad, undefined, 41);
    const blocked = { ...bad, qaReports: [qa] };
    assert.equal(cinematographyApprovalBlockers(blocked, blocked.shotPlans[0]!.id).length, 1);
    assert.equal(approveCinematographyPlan(blocked, blocked.shotPlans[0]!.id, 42).approvals.length, 0);
  });
});
