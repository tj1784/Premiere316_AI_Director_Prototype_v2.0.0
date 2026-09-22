import test from "node:test";
import assert from "node:assert/strict";
import {
  GAIN_MODEL_ID,
  GAIN_MTP_FILE,
  GAIN_REGULAR_FILE,
  defaultProductionRouting,
  hydrateProductionRouting,
  isRegularGainArtifact,
  refreshLocalBindingStatuses,
  selectProductionExecutionMode,
  selectProductionProfile,
} from "./production-profiles.ts";

test("new work defaults to Astra Ultra and guided review", () => {
  const state = defaultProductionRouting(10);
  assert.equal(state.profileId, "astra-ultra");
  assert.equal(state.executionMode, "guided");
  assert.equal(state.bindings.every((binding) => binding.callableModelId === null), true);
});

test("legacy explicit local selection migrates to Local Models without enabling autonomy", () => {
  const state = hydrateProductionRouting(null, { legacyLocalSelection: true, now: 20 });
  assert.equal(state.profileId, "local-models");
  assert.equal(state.executionMode, "guided");
  assert.equal(state.bindings.find((binding) => binding.role === "prompt-cue")?.callableModelId, GAIN_MODEL_ID);
});

test("regular GAIN artifact remains eligible through the inherited MTP alias", () => {
  assert.equal(isRegularGainArtifact({ artifactFileName: GAIN_REGULAR_FILE, callableModelId: GAIN_MODEL_ID }), true);
  assert.equal(isRegularGainArtifact({ artifactFileName: GAIN_MTP_FILE, callableModelId: GAIN_MODEL_ID }), false);
  assert.equal(isRegularGainArtifact({ artifactFileName: GAIN_REGULAR_FILE, callableModelId: "invented-non-mtp-alias" }), false);
});

test("availability refresh distinguishes installed, loaded, optional missing and offline", () => {
  let state = selectProductionProfile(defaultProductionRouting(1), "local-models", 2);
  state = refreshLocalBindingStatuses(state, [
    { id: "nousresearch/hermes-4-70b", loaded: false },
    { id: GAIN_MODEL_ID, loaded: true },
    { id: "gptoss-120b-uncensored-hauhaucs-aggressive", loaded: false },
  ], true);
  assert.equal(state.bindings.find((binding) => binding.role === "writer")?.status, "installed");
  assert.equal(state.bindings.find((binding) => binding.role === "prompt-cue")?.status, "loaded");
  assert.equal(state.bindings.find((binding) => binding.role === "challenger")?.status, "unavailable");
  const offline = refreshLocalBindingStatuses(state, [], false, "Local API offline");
  assert.equal(offline.bindings.every((binding) => binding.status === "needs-refresh"), true);
});

test("autonomous selection is explicit and does not become a new default", () => {
  const selected = selectProductionExecutionMode(defaultProductionRouting(1), "autonomous-complete-script", 2);
  assert.equal(selected.executionMode, "autonomous-complete-script");
  assert.equal(defaultProductionRouting(3).executionMode, "guided");
});
