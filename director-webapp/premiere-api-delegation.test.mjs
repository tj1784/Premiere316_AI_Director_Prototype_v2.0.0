import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PREMIERE_API_URL,
  PremiereApiError,
  premiereApiBaseUrl,
  queueSemanticT2VViaPremiere,
  semanticT2VDelegationTarget
} from "./premiere-api-delegation.mjs";

const semanticProject = { settings: { videoGenerationMode: "t2v_with_semantic_references" } };
const storyboardWorkspace = {
  premiere: {
    source: "storyboard",
    projectSlug: "harrowing_of_hell",
    videoPlanId: "video-h01-s01-c01"
  }
};

test("Premiere API URL defaults to the canonical 8789 listener", () => {
  assert.equal(premiereApiBaseUrl(""), DEFAULT_PREMIERE_API_URL);
  assert.equal(premiereApiBaseUrl("http://127.0.0.1:9000/"), "http://127.0.0.1:9000");
});

test("delegation is restricted to explicit storyboard semantic T2V timeline requests", () => {
  assert.deepEqual(semanticT2VDelegationTarget({ mode: "timeline", workspace: storyboardWorkspace, project: semanticProject }), {
    projectSlug: "harrowing_of_hell",
    videoPlanId: "video-h01-s01-c01"
  });
  assert.equal(semanticT2VDelegationTarget({ mode: "segments", workspace: storyboardWorkspace, project: semanticProject }), null);
  assert.equal(semanticT2VDelegationTarget({ mode: "timeline", workspace: storyboardWorkspace, project: { settings: { videoGenerationMode: "legacy" } } }), null);
  assert.equal(semanticT2VDelegationTarget({ mode: "timeline", workspace: { premiere: { ...storyboardWorkspace.premiere, source: "manual" } }, project: semanticProject }), null);
});

test("canonical generation response returns its durable queue job id", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ job: { id: "job-123" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const result = await queueSemanticT2VViaPremiere({
    baseUrl: "http://127.0.0.1:8789",
    projectSlug: "harrowing_of_hell",
    videoPlanId: "video-h01-s01-c01",
    fetchImpl
  });
  assert.equal(result.jobId, "job-123");
  assert.equal(request.url, "http://127.0.0.1:8789/api/projects/harrowing_of_hell/storyboard/video-plans/video-h01-s01-c01/generate");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, "{}");
});

test("canonical rejection preserves the upstream status and exact error", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: "Required reference is missing" }), { status: 409 });
  await assert.rejects(
    queueSemanticT2VViaPremiere({
      baseUrl: "http://127.0.0.1:8789",
      projectSlug: "harrowing_of_hell",
      videoPlanId: "video-h01-s01-c01",
      fetchImpl
    }),
    (error) => error instanceof PremiereApiError && error.status === 409 && error.message === "Required reference is missing"
  );
});

test("a successful response without job.id is rejected", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ job: {} }), { status: 200 });
  await assert.rejects(
    queueSemanticT2VViaPremiere({
      baseUrl: "http://127.0.0.1:8789",
      projectSlug: "harrowing_of_hell",
      videoPlanId: "video-h01-s01-c01",
      fetchImpl
    }),
    (error) => error instanceof PremiereApiError && error.status === 502 && /missing job\.id/.test(error.message)
  );
});
