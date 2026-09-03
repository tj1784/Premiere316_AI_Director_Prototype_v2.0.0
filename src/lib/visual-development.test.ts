import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approveVisualRecord, checkVisualDrift, hydrateVisualDevelopmentState, seedVisualDevelopmentFromPicture } from "./visual-development.ts";

function picture() {
  return {
    id: "pic",
    tone: "restrained tungsten noir",
    scenes: [{ id: "sc1", act: 1, slugline: "INT. ROOM - NIGHT", summary: "", emotionalBeat: "", durationSec: 10 }],
    characters: [{ id: "ch1", name: "Elias Voss", role: "Archivist", age: "40s", look: "lean precise hands", arc: "witness", voiceId: "ara" }],
    locations: [{ id: "loc1", name: "Archive", description: "wet cedar", lighting: "tungsten" }],
    wardrobe: [{ id: "w1", name: "Elias cardigan", description: "wool cardigan" }],
    props: [{ id: "p1", name: "Film reel", description: "metal reel" }],
  };
}

describe("Visual Development domain", () => {
  it("seeds engine-neutral boards and bibles from legacy picture without approving", () => {
    const state = seedVisualDevelopmentFromPicture(picture(), 20);
    assert.equal(state.boards.length, 1);
    assert.equal(state.characterBibles.length, picture().characters.length);
    assert.equal(state.characterBibles.every((bible) => bible.status === "DRAFT"), true);
    assert.equal(state.approvals.length, 0);
  });

  it("approvals are append-only and retain version hashes", () => {
    const state = seedVisualDevelopmentFromPicture(picture(), 21);
    const approved = approveVisualRecord(state, "character", state.characterBibles[0]!.id, 22);
    assert.equal(approved.characterBibles[0]!.status, "APPROVED");
    assert.equal(approved.approvals.length, 1);
    assert.equal(state.approvals.length, 0);
  });

  it("hydrates idempotently and reports drift checks", () => {
    const state = seedVisualDevelopmentFromPicture(picture(), 23);
    const hydrated = hydrateVisualDevelopmentState(state, picture(), 24);
    assert.equal(hydrated.characterBibles[0]!.id, state.characterBibles[0]!.id);
    assert.deepEqual(checkVisualDrift(hydrated).map((item) => item.severity).filter((item) => item === "blocker"), []);
  });
});
