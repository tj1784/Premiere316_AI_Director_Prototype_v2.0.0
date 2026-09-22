import assert from "node:assert/strict";
import test from "node:test";
import { profileTextRuntime, productionRoleForStep } from "./profile-text-runtime.ts";
import { localProductionBindings } from "./production-profiles.ts";
import type { Picture } from "./types.ts";

const picture = () =>
  ({
    id: "qa-profile",
    screenplay: {},
    productionRouting: {
      schemaVersion: 1,
      profileRevision: 6,
      profileId: "local-models",
      executionMode: "guided",
      activeRun: null,
      bindings: localProductionBindings().map((binding) => ({ ...binding, status: "installed" })),
      updatedAt: 0,
    },
  }) as Picture;

test("research, screenplay, review and asset prompts use the exact role, never the legacy selector", async () => {
  assert.equal(productionRoleForStep("research"), "architect");
  assert.equal(productionRoleForStep("screenplayQa"), "reviewer");
  const source = picture();
  const calls: string[] = [];
  const runtime = profileTextRuntime(source, async (request) => {
    calls.push(request.binding.role);
    assert.ok(request.requestId.startsWith("profile-text:qa-profile:"));
    return { text: "fixture" };
  });
  source.productionRouting!.bindings[0].callableModelId = "changed-after-start";
  for (const stepId of [
    "research",
    "screenplay",
    "screenplayQa",
    "assetPrompts",
    "promptLab",
  ] as const)
    await runtime.generate!({ stepId, system: "test", prompt: "test" });
  assert.deepEqual(calls, ["architect", "writer", "reviewer", "prompt-cue", "prompt-cue"]);
});

test("unavailable profile or phase binding fails without fallback", async () => {
  const source = picture();
  source.productionRouting!.bindings.find((binding) => binding.role === "prompt-cue")!.status =
    "unavailable";
  let calls = 0;
  const generate = async () => {
    calls++;
    return { text: "never" };
  };
  assert.equal(profileTextRuntime(source, generate, "prompt-cue").available, false);
  await assert.rejects(
    profileTextRuntime(source, generate).generate!({
      stepId: "assetPrompts",
      system: "",
      prompt: "",
    }),
  );
  assert.equal(calls, 0);
});
