import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalStoryboardReferenceRole,
  EXPLICIT_USER_REFERENCES_ONLY,
  enforceExplicitUserReferencePolicy,
  MAX_STORYBOARD_SEMANTIC_REFERENCES,
  replaceStoryboardTargetReferences,
  storyboardUsesExplicitUserReferences
} from "../server/storyboard.js";
import {
  canonicalSemanticReferenceRole,
  LTX25_PREMIERE316_PROFILE
} from "../director-webapp/premiere-api-delegation.mjs";

function fixture() {
  const binding = {
    id: "ref-imported",
    assetId: "asset-jesus",
    assetVersionId: "asset-jesus:v1",
    assetVersion: 1,
    sourceAssetFile: "media/assets/jesus.png",
    canonicalFile: "characters/jesus.png",
    role: "identity",
    targetKind: "frame",
    targetId: "frame-example",
    order: 1
  };
  return {
    schemaVersion: "premiere316.storyboard.v1",
    projectId: "fixture",
    storyboardId: "fixture-board",
    chapterOrder: ["chapter-1"],
    defaults: { visualReferencePersistence: EXPLICIT_USER_REFERENCES_ONLY },
    chapters: { "chapter-1": { id: "chapter-1", sceneIds: ["scene-1"] } },
    scenes: { "scene-1": { id: "scene-1", clipIds: ["clip-1"] } },
    clips: {
      "clip-1": {
        id: "clip-1",
        videoPlanId: "video-clip-1",
        firstFrameId: "frame-example",
        referenceFiles: ["characters/jesus.png"],
        voiceReferences: [{ assetId: "voice-jesus" }]
      }
    },
    frames: {
      "frame-example": {
        id: "frame-example",
        prompt: "Keep this prompt exact.",
        generatedFile: "media/frames/example.png",
        generatedVersions: [{ id: "v1", sourceReferenceAssets: [{ assetId: "historical-jesus" }] }],
        references: [binding]
      }
    },
    videoPlans: {
      "video-clip-1": {
        id: "video-clip-1",
        clipId: "clip-1",
        segmentIds: ["segment-example"],
        globalPrompt: "Keep the global prompt exact.",
        referenceFiles: ["characters/jesus.png"],
        referenceCount: 1,
        droppedReferenceFiles: [],
        firstFramePackage: { packageId: "temporal-package" },
        timelineData: { segments: [{ id: "segment-example", referenceFiles: ["characters/jesus.png"] }] }
      }
    },
    segments: {
      "segment-example": {
        id: "segment-example",
        frameId: "frame-example",
        imageFile: "media/frames/example.png",
        prompt: "Keep this segment prompt exact.",
        usePreviousAsFirstFrame: true,
        useNextAsLastFrame: true,
        referenceFiles: ["characters/jesus.png"]
      }
    },
    referenceBindings: { [binding.id]: binding }
  };
}

const project = {
  slug: "fixture",
  settings: { visualReferencePersistence: EXPLICIT_USER_REFERENCES_ONLY },
  assets: {
    items: [{
      id: "asset-jesus",
      activeVersion: 2,
      versions: [
        { v: 1, file: "media/assets/jesus-v1.png" },
        { v: 2, file: "media/assets/jesus-v2.png" }
      ]
    }]
  }
};

test("explicit-user-only policy strips imported active references without touching temporal, prompt, voice, or provenance data", () => {
  const storyboard = fixture();
  const original = structuredClone(storyboard);
  const next = enforceExplicitUserReferencePolicy(storyboard);
  assert.deepEqual(storyboard, original, "sanitizer must not mutate its input");
  assert.deepEqual(next.referenceBindings, {});
  assert.deepEqual(next.frames["frame-example"].references, []);
  assert.deepEqual(next.clips["clip-1"].referenceFiles, []);
  assert.deepEqual(next.videoPlans["video-clip-1"].referenceFiles, []);
  assert.equal(next.videoPlans["video-clip-1"].referenceCount, 0);
  assert.deepEqual(next.segments["segment-example"].referenceFiles, []);
  assert.deepEqual(next.videoPlans["video-clip-1"].timelineData.segments[0].referenceFiles, []);
  assert.equal(next.frames["frame-example"].prompt, original.frames["frame-example"].prompt);
  assert.equal(next.frames["frame-example"].generatedFile, original.frames["frame-example"].generatedFile);
  assert.deepEqual(next.frames["frame-example"].generatedVersions, original.frames["frame-example"].generatedVersions);
  assert.deepEqual(next.clips["clip-1"].voiceReferences, original.clips["clip-1"].voiceReferences);
  assert.equal(next.segments["segment-example"].imageFile, original.segments["segment-example"].imageFile);
  assert.equal(next.segments["segment-example"].usePreviousAsFirstFrame, true);
  assert.equal(next.segments["segment-example"].useNextAsLastFrame, true);
});

test("user can add, update, and remove a selected frame reference under explicit-user-only policy", () => {
  const clean = enforceExplicitUserReferencePolicy(fixture());
  const added = replaceStoryboardTargetReferences(clean, project, {
    targetKind: "frame",
    targetId: "frame-example",
    references: [{ assetId: "asset-jesus", assetVersion: 1, role: "identity", required: true }]
  });
  assert.equal(added.references.length, 1);
  assert.equal(added.references[0].persistenceOrigin, "user");
  assert.equal(added.references[0].assetVersion, 1);
  assert.equal(Object.keys(enforceExplicitUserReferencePolicy(added.storyboard).referenceBindings).length, 1);

  const updated = replaceStoryboardTargetReferences(added.storyboard, project, {
    targetKind: "frame",
    targetId: "frame-example",
    references: [{ ...added.references[0], assetVersion: 2, role: "wardrobe", required: false }]
  });
  assert.equal(updated.references[0].assetVersion, 2);
  assert.equal(updated.references[0].role, "wardrobe");
  assert.equal(updated.references[0].required, false);

  const removed = replaceStoryboardTargetReferences(updated.storyboard, project, {
    targetKind: "frame",
    targetId: "frame-example",
    references: []
  });
  assert.deepEqual(removed.references, []);
  assert.deepEqual(removed.storyboard.frames["frame-example"].references, []);
  assert.deepEqual(removed.storyboard.referenceBindings, {});
});

test("user can add, update, and remove a video-plan reference for a text-segment fallback", () => {
  const clean = enforceExplicitUserReferencePolicy(fixture());
  clean.segments["segment-example"].type = "text";
  delete clean.segments["segment-example"].frameId;
  delete clean.segments["segment-example"].imageFile;
  const timelineSegment = clean.videoPlans["video-clip-1"].timelineData.segments[0];
  timelineSegment.type = "text";
  delete timelineSegment.storyboardFrameId;
  delete timelineSegment.imageFile;

  const added = replaceStoryboardTargetReferences(clean, project, {
    targetKind: "video_plan",
    targetId: "video-clip-1",
    references: [{ assetId: "asset-jesus", assetVersion: 1, role: "identity", required: true }]
  });
  assert.equal(added.references.length, 1);
  assert.equal(added.references[0].targetKind, "video_plan");
  assert.equal(added.references[0].persistenceOrigin, "user");
  assert.equal(added.references[0].useMode, "semantic_reference");
  assert.equal(added.storyboard.videoPlans["video-clip-1"].referenceCount, 1);
  assert.deepEqual(added.storyboard.videoPlans["video-clip-1"].referenceFiles, ["media/assets/jesus-v1.png"]);
  assert.deepEqual(added.storyboard.clips["clip-1"].referenceFiles, ["media/assets/jesus-v1.png"]);
  assert.equal(Object.keys(enforceExplicitUserReferencePolicy(added.storyboard).referenceBindings).length, 1);

  const updated = replaceStoryboardTargetReferences(added.storyboard, project, {
    targetKind: "video_plan",
    targetId: "video-clip-1",
    references: [{
      id: added.references[0].id,
      assetId: added.references[0].assetId,
      assetVersion: 2,
      role: "style",
      useMode: added.references[0].useMode,
      required: false
    }]
  });
  assert.equal(updated.references[0].id, added.references[0].id);
  assert.equal(updated.references[0].assetVersion, 2);
  assert.equal(updated.references[0].role, "atmosphere", "supported aliases are stored as compiler-canonical roles");
  assert.equal(updated.references[0].required, false);
  assert.deepEqual(updated.storyboard.videoPlans["video-clip-1"].referenceFiles, ["media/assets/jesus-v2.png"]);
  assert.deepEqual(updated.storyboard.clips["clip-1"].referenceFiles, ["media/assets/jesus-v2.png"]);

  const removed = replaceStoryboardTargetReferences(updated.storyboard, project, {
    targetKind: "video_plan",
    targetId: "video-clip-1",
    references: []
  });
  assert.deepEqual(removed.references, []);
  assert.equal(removed.storyboard.videoPlans["video-clip-1"].referenceCount, 0);
  assert.deepEqual(removed.storyboard.videoPlans["video-clip-1"].referenceFiles, []);
  assert.deepEqual(removed.storyboard.clips["clip-1"].referenceFiles, []);
  assert.deepEqual(removed.storyboard.referenceBindings, {});
  assert.equal(removed.storyboard.segments["segment-example"].type, "text");
  assert.equal(removed.storyboard.segments["segment-example"].frameId, undefined);
});

test("policy is detected from either storyboard defaults or project settings", () => {
  assert.equal(storyboardUsesExplicitUserReferences({ defaults: { visualReferencePersistence: EXPLICIT_USER_REFERENCES_ONLY } }), true);
  assert.equal(storyboardUsesExplicitUserReferences({ defaults: {} }, project), true);
  assert.equal(storyboardUsesExplicitUserReferences({ defaults: {} }, { settings: {} }), false);
});

test("reference replacement rejects roles outside the compiler contract", () => {
  const clean = enforceExplicitUserReferencePolicy(fixture());
  assert.throws(() => replaceStoryboardTargetReferences(clean, project, {
    targetKind: "frame",
    targetId: "frame-example",
    references: [{ assetId: "asset-jesus", assetVersion: 1, role: "graphic", required: true }]
  }), /unsupported role graphic/);
});

test("storyboard role aliases and reference limit stay aligned with the LTX compiler contract", () => {
  const supportedInputs = [
    "identity", "character", "face", "actor",
    "wardrobe", "costume", "clothing",
    "location", "environment", "set", "composition",
    "prop", "artifact", "vehicle",
    "crowd", "crowds", "extra", "extras", "creature",
    "atmosphere", "atmosphere_vfx", "vfx", "lighting", "style"
  ];
  assert.deepEqual(
    supportedInputs.map(canonicalStoryboardReferenceRole),
    supportedInputs.map(canonicalSemanticReferenceRole)
  );
  assert.deepEqual(
    [...new Set(supportedInputs.map(canonicalStoryboardReferenceRole))],
    [...LTX25_PREMIERE316_PROFILE.semanticRoles]
  );
  assert.equal(MAX_STORYBOARD_SEMANTIC_REFERENCES, LTX25_PREMIERE316_PROFILE.maxSemanticReferences);
});

test("reference replacement rejects more than nine references at the CRUD boundary", () => {
  const clean = enforceExplicitUserReferencePolicy(fixture());
  assert.throws(() => replaceStoryboardTargetReferences(clean, project, {
    targetKind: "frame",
    targetId: "frame-example",
    references: Array.from({ length: 10 }, (_, index) => ({
      assetId: `asset-${index + 1}`,
      assetVersion: 1,
      role: "identity",
      required: true
    }))
  }), /supports at most 9 visual references; received 10/);
});
