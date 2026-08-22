import test from "node:test";
import assert from "node:assert/strict";
import {
  actionsForSlotState,
  slotStateFromAsset,
  resultActions,
  describeAttach,
  resultActions as resultActionsNamed,
  buildMissingWorkIndex,
  withCharacterDependency
} from "../client/src/contextual-agency/agency.js";
import {
  attachForIntent,
  generateBlockReason,
  generateForIntent,
  generateQwenTtsCue,
  nextMissingIntent,
  isLtxDialogueCue,
  isVoiceCategory,
  cueLinesForCharacter,
  locksFromBundle,
  withContinuityLocks,
  mergeStoryboardReference,
  resolveStoryboardAttachTarget,
  saveAuditionToLibrary,
  selectAudition,
  OFFLINE_MANUAL_ACTIONS
} from "../client/src/contextual-agency/agency-actions.js";

function mockStore(overrides = {}) {
  const calls = [];
  const store = {
    calls,
    project: { slug: "harrowing", id: "harrowing", assets: { items: [] } },
    storyboard: {
      frames: { "H04-S13-C03-F01": { references: [] } },
      clips: { "H04-S13-C03": { id: "H04-S13-C03", firstFrameId: "H04-S13-C03-F01" } },
      videoPlans: {},
      segments: {}
    },
    health: { comfy: true, capabilities: { qwenVoiceDesign: true } },
    async createAsset(body) { calls.push(["createAsset", body]); return { id: "voice-david", ...body, activeVersion: 0 }; },
    async patchAsset(id, body) { calls.push(["patchAsset", id, body]); },
    async uploadAssetImage(id, file) { calls.push(["uploadAssetImage", id, file.name]); return { id, activeVersion: 1, name: id }; },
    async uploadAssetAudio(id, file) { calls.push(["uploadAssetAudio", id, file.name]); return { id, activeVersion: 1, name: id }; },
    async generateAsset(id) { calls.push(["generateAsset", id]); },
    async approveAsset(id) { calls.push(["approveAsset", id]); },
    async replaceStoryboardReferences(kind, targetId, references) { calls.push(["replaceStoryboardReferences", kind, targetId, references]); },
    async refreshQueue() { calls.push(["refreshQueue"]); },
    ...overrides
  };
  return store;
}

test("helpers come from the shared agency module", () => {
  assert.equal(actionsForSlotState("missing").includes("generate"), true);
  assert.equal(slotStateFromAsset(null), "missing");
  assert.equal(withCharacterDependency([], "character-david")[0], "character-david");
});

test("voice generate posts to Qwen Voice Design and never calls generateAsset", async () => {
  const store = mockStore();
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ session: { id: "qvd_1" }, job: { id: "job-9" } }) };
  };
  const result = await generateForIntent(store, {
    sourceEntity: { type: "character", id: "character-david", label: "David" },
    requirement: { relationship: "character.voice", category: "voice" }
  }, { voiceName: "David", instruct: "grave, adult male", auditionText: "The hour has come." }, fetchImpl);
  assert.equal(result.provider, "qwen-voice-design");
  assert.equal(posts[0].url.includes("/sound/voice-design/auditions"), true);
  assert.equal(posts[0].body.characterId, "character-david");
  assert.equal(store.calls.some((call) => call[0] === "generateAsset"), false);
  assert.equal(store.calls.some((call) => call[0] === "refreshQueue"), true);
});

test("image generate still uses Comfy generateAsset", async () => {
  const store = mockStore();
  const result = await generateForIntent(store, {
    sourceEntity: { type: "character", id: "character-david", label: "David" },
    requirement: { relationship: "character.wardrobe", category: "wardrobe" }
  }, { name: "David wardrobe" });
  assert.equal(result.provider, "comfy");
  assert.equal(store.calls.some((call) => call[0] === "generateAsset"), true);
});

test("voice generate stays disabled when Qwen is offline", () => {
  const reason = generateBlockReason(
    { requirement: { category: "voice" } },
    { comfy: true, capabilities: { qwenVoiceDesign: false } }
  );
  assert.match(reason, /Qwen/);
  assert.equal(isVoiceCategory("voice"), true);
});

test("character attach writes a dependency", async () => {
  const store = mockStore();
  await attachForIntent(store, {
    sourceEntity: { type: "character", id: "character-david", label: "David" },
    requirement: { relationship: "character.wardrobe", category: "wardrobe" }
  }, { id: "wardrobe-david", dependencies: [] });
  assert.deepEqual(store.calls[0], ["patchAsset", "wardrobe-david", { dependencies: ["character-david"] }]);
});

test("storyboard attach pins a frame reference", async () => {
  const store = mockStore();
  const result = await attachForIntent(store, {
    sourceEntity: { type: "storyboard-frame", id: "H04-S13-C03-F01", label: "C03 opener" },
    requirement: { relationship: "storyboardFrame.locationReference", category: "location" }
  }, { id: "location-hell-gate", activeVersion: 2, name: "Hell Gate" });
  assert.equal(result.kind, "storyboard-reference");
  assert.equal(result.target.kind, "frame");
  const call = store.calls.find((item) => item[0] === "replaceStoryboardReferences");
  assert.equal(call[1], "frame");
  assert.equal(call[2], "H04-S13-C03-F01");
  assert.equal(call[3][0].assetId, "location-hell-gate");
  assert.equal(call[3][0].assetVersion, 2);
  assert.equal(call[3][0].role, "location");
});

test("clip attach resolves to the first frame", () => {
  const storyboard = mockStore().storyboard;
  assert.deepEqual(
    resolveStoryboardAttachTarget(storyboard, { type: "clip", id: "H04-S13-C03" }),
    { kind: "frame", id: "H04-S13-C03-F01" }
  );
});

test("attach protocol still names the originating entity", () => {
  const intent = {
    sourceRoute: "/storyboard",
    sourceEntity: { type: "storyboard-frame", id: "F01", label: "Opener" },
    requirement: { relationship: "storyboardFrame.locationReference", category: "location" }
  };
  const result = { assetId: "location-1", version: 1, approved: false, kind: "uploaded" };
  assert.equal(resultActions(intent, result).some((item) => item.id === "attach-storyboard"), true);
  assert.equal(describeAttach(intent, result).relationship, "storyboardFrame.locationReference");
  assert.equal(mergeStoryboardReference([], { id: "location-1", activeVersion: 1 }, "location").length, 1);
});

test("missing-work index still skips approved slots", () => {
  const index = buildMissingWorkIndex({
    characters: [{
      id: "character-david",
      name: "David",
      sheets: [{ file: "a.png", approvalCurrent: true }],
      wardrobe: [],
      voices: [{ file: "v.wav", approvalCurrent: false }]
    }]
  });
  assert.equal(index.counts.total, 2);
});


test("CHR-008 queues three Qwen auditions and never mentions IndexTTS", async () => {
  const store = mockStore();
  let body = null;
  const fetchImpl = async (url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ session: { id: "qvd_3", auditions: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] }, job: { id: "job-3" } }) };
  };
  await generateForIntent(store, {
    sourceEntity: { type: "character", id: "character-david", label: "David" },
    requirement: { relationship: "character.voice", category: "voice" }
  }, { voiceName: "David", cueLines: ["Father, into your hands."] }, fetchImpl);
  assert.equal(body.auditionCount, 3);
  assert.equal(JSON.stringify(body).toLowerCase().includes("indextts"), false);
});

test("CHR-008 save and select post to the Qwen audition actions", async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(`${init.method} ${url}`);
    return { ok: true, json: async () => ({ asset: { id: "voice-david", name: "David", activeVersion: 1 } }) };
  };
  await saveAuditionToLibrary("harrowing", "aud-1", fetchImpl);
  await selectAudition("harrowing", "aud-1", fetchImpl);
  assert.equal(urls[0].includes("/auditions/aud-1/save-to-library"), true);
  assert.equal(urls[1].includes("/auditions/aud-1/select"), true);
});

test("LIB-003 image generate attaches back to the originating character", async () => {
  const store = mockStore();
  const result = await generateForIntent(store, {
    sourceEntity: { type: "character", id: "character-david", label: "David" },
    requirement: { relationship: "character.wardrobe", category: "wardrobe" }
  }, { name: "David wardrobe" });
  assert.equal(result.attached.kind, "character-dependency");
  assert.equal(store.calls.some((call) => call[0] === "patchAsset"), true);
});

test("OFF-001 to OFF-004 keep manual actions when generate is offline", () => {
  const voice = generateBlockReason({ requirement: { category: "voice" } }, { comfy: true, capabilities: { qwenVoiceDesign: false } });
  const image = generateBlockReason({ requirement: { category: "character" } }, { comfy: false, capabilities: { qwenVoiceDesign: true } });
  assert.match(voice, /Upload, create, choose, and review stay available/);
  assert.match(image, /Upload, create, choose, and review stay available/);
  assert.deepEqual(OFFLINE_MANUAL_ACTIONS, ["upload", "create", "choose", "review"]);
});


test("LTX-002 Use as first writes the asset file onto the selected LTX segment", async () => {
  const { applyLtxFirstGuide } = await import("../client/src/contextual-agency/agency-actions.js");
  const workspace = { selectedSegmentId: "seg-1", timeline: { segments: [{ id: "seg-1", missingGuide: true }] } };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push([init.method || "GET", url]);
    if (!init.method || init.method === "GET") {
      return { ok: true, json: async () => ({ workspace }) };
    }
    const body = JSON.parse(init.body);
    assert.equal(body.workspace.timeline.segments[0].imageFile, "guides/first.png");
    assert.equal(body.workspace.timeline.segments[0].missingGuide, false);
    assert.equal(body.workspace.timeline.segments[0].usePreviousAsFirstFrame, false);
    return { ok: true, json: async () => ({ workspace: body.workspace }) };
  };
  const result = await applyLtxFirstGuide(
    { id: "guide-1", name: "Opener", file: "guides/first.png", activeVersion: 1 },
    { sourceEntity: { type: "guide", id: "seg-1", label: "seg-1 first guide" }, requirement: { relationship: "ltx.firstGuide" } },
    fetchImpl
  );
  assert.equal(result.kind, "ltx-first-guide");
  assert.equal(calls[1][0], "PUT");
});

test("attach protocol names Use as first for a guide result", () => {
  const actions = resultActions({
    sourceEntity: { type: "guide", id: "seg-1", label: "first guide" },
    requirement: { relationship: "ltx.firstGuide", category: "guide-frame" },
    sourceRoute: "/direct/ltx"
  }, { assetId: "guide-1", kind: "generated" });
  assert.equal(actions.some((action) => action.label === "Use as first"), true);
});


import {
  assertNewFileHash,
  findDuplicateHash,
  previousVersion,
  restoreForIntent,
  reuseExistingVersion,
  attachAudit
} from "../client/src/contextual-agency/agency-actions.js";

test("VER duplicate-hash guard refuses an exact imported take", () => {
  const items = [{
    id: "voice-david",
    name: "David",
    versions: [{ v: 2, sha256: "abc123", fileHashes: [{ sha256: "abc123" }] }]
  }];
  const hit = findDuplicateHash(items, "ABC123");
  assert.equal(hit.version.v, 2);
  assert.throws(() => assertNewFileHash(items, "abc123"), /Reuse that version/);
});

test("VER restore selects the previous version", async () => {
  const asset = { id: "sheet-david", name: "David", activeVersion: 3, versions: [{ v: 2, file: "a.png" }, { v: 3, file: "b.png" }] };
  assert.equal(previousVersion(asset).v, 2);
  const store = mockStore();
  store.restoreAssetVersion = async (id, version) => {
    store.calls.push(["restoreAssetVersion", id, version]);
    return { ...asset, activeVersion: version, file: "a.png" };
  };
  const next = await restoreForIntent(store, asset);
  assert.equal(next.activeVersion, 2);
  assert.deepEqual(store.calls[0], ["restoreAssetVersion", "sheet-david", 2]);
});

test("attach audit covers segment audio and library fallback", async () => {
  const store = mockStore({
    selectedStoryboardClipId: "H04-S13-C03",
    async saveStoryboardDirection(body) { store.calls.push(["saveStoryboardDirection", body]); }
  });
  store.storyboard.segments = { "segment-c03-01": { id: "segment-c03-01", clipId: "H04-S13-C03" } };
  const audio = await attachForIntent(store, {
    sourceEntity: { type: "segment", id: "segment-c03-01", label: "C03" },
    requirement: { relationship: "segment.dialogueAudio", category: "dialogue", expectedMediaType: "audio" }
  }, { id: "voice-david", name: "David", activeVersion: 1 });
  assert.equal(audio.kind, "segment-audio");
  const library = await attachForIntent(store, {
    sourceEntity: { type: "library", id: "lib", label: "Library" },
    requirement: { relationship: "library.slot", category: "location" }
  }, { id: "location-1", name: "Gate", activeVersion: 1 });
  assert.equal(library.kind, "storyboard-reference");
});


test("VER hash match reuses instead of minting vN+1", () => {
  const items = [{
    id: "voice-david",
    name: "David",
    versions: [{ v: 2, file: "david.wav", sha256: "abc123" }]
  }];
  const hit = findDuplicateHash(items, "abc123");
  const reused = reuseExistingVersion(hit);
  assert.equal(reused.reused, true);
  assert.equal(reused.asset.activeVersion, 2);
  assert.equal(reused.asset.id, "voice-david");
});

test("VER restore audit keeps later versions", async () => {
  const asset = {
    id: "sheet-david",
    name: "David",
    activeVersion: 3,
    versions: [{ v: 1, file: "a.png" }, { v: 2, file: "b.png" }, { v: 3, file: "c.png" }],
    continuity: []
  };
  const store = mockStore();
  store.restoreAssetVersion = async (id, version, extras) => {
    store.calls.push(["restoreAssetVersion", id, version, extras?.continuity?.[0]]);
    return { ...asset, activeVersion: version, file: "b.png", versions: asset.versions, continuity: extras.continuity };
  };
  const next = await restoreForIntent(store, asset, 2);
  assert.equal(next.activeVersion, 2);
  assert.deepEqual(next.versions.map((version) => version.v), [1, 2, 3]);
  assert.equal(next.restoreAudit.deletedVersions.length, 0);
  assert.match(next.restoreAudit.keptVersions.join(","), /3/);
});

test("attach audit names entity, relationship, version, fingerprint, source, previous", () => {
  const audit = attachAudit({
    sourceRoute: "/storyboard",
    sourceEntity: { type: "segment", id: "segment-c03-01", label: "C03" },
    requirement: { relationship: "segment.dialogueAudio", category: "dialogue" }
  }, {
    id: "voice-david",
    activeVersion: 2,
    approvalCurrent: false,
    approval: { versionFingerprint: "fp-22" },
    versions: [{ v: 2, assetFingerprint: "fp-22" }]
  }, { kind: "segment-audio" }, { previousRelationship: "segment.ambience", previousVersion: 1 });
  assert.equal(audit.sourceEntity, "segment:segment-c03-01");
  assert.equal(audit.relationship, "segment.dialogueAudio");
  assert.equal(audit.previousRelationship, "segment.ambience");
  assert.equal(audit.assetId, "voice-david");
  assert.equal(audit.exactVersion, 2);
  assert.equal(audit.approvalFingerprint, "fp-22");
  assert.equal(audit.opSource, "/storyboard");
  assert.equal(typeof audit.timestamp, "string");
  assert.equal(audit.previousVersion, 1);
  assert.equal(audit.approvalFingerprint, "fp-22");
});


test("STB-002 generate dialogue posts Qwen TTS of the cue, not Voice Design", async () => {
  const store = mockStore();
  store.health = { comfy: true, capabilities: { qwenTts: true, qwenVoiceDesign: true } };
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: init.body });
    return { ok: true, json: async () => ({ generation: { id: "gen-1" }, job: { id: "job-tts" } }) };
  };
  const result = await generateForIntent(store, {
    sourceEntity: { type: "segment", id: "segment-c03-01", label: "C03" },
    requirement: { relationship: "segment.dialogueAudio", category: "dialogue", expectedMediaType: "audio" }
  }, { sampleText: "The hour has come." }, fetchImpl);
  assert.equal(result.provider, "qwen-tts");
  assert.equal(posts[0].url.includes("/sound/qwen-tts/generations"), true);
  assert.equal(String(posts[0].url).includes("voice-design"), false);
});


test("drawer continue-missing opens the next character hole", () => {
  const store = mockStore({
    project: {
      slug: "harrowing",
      assets: { items: [{ id: "adam", category: "character", name: "Adam" }] }
    }
  });
  const next = nextMissingIntent(store, {
    sourceRoute: "/assets/characters",
    sourceEntity: { type: "character", id: "adam", label: "Adam" },
    requirement: { relationship: "character.sheet", category: "character", expectedMediaType: "image" },
    initialAction: "generate"
  });
  assert.equal(next.requirement.relationship, "character.wardrobe");
  const afterWardrobe = nextMissingIntent({
    ...store,
    project: {
      slug: "harrowing",
      assets: { items: [
        { id: "adam", category: "character", name: "Adam" },
        { id: "adam-wardrobe", category: "wardrobe", dependencies: ["adam"] }
      ] }
    }
  }, next);
  assert.equal(afterWardrobe.requirement.relationship, "character.voice");
  assert.equal(afterWardrobe.initialAction, "create");
});


test("LTX-001 attach-back binds the LTX cue and never pins Storyboard", async () => {
  const store = mockStore();
  store.saveStoryboardDirection = async (body) => { store.calls.push(["saveStoryboardDirection", body]); };
  store.replaceStoryboardReferences = async (...args) => { store.calls.push(["replaceStoryboardReferences", ...args]); };
  const intent = {
    sourceRoute: "/direct/ltx",
    sourceEntity: { type: "segment", id: "seg-ltx-1", label: "C03-Q01 · David" },
    requirement: { relationship: "ltx.dialogueCue", category: "dialogue", expectedMediaType: "audio", expectedVariant: "C03-Q01" },
    returnFocusId: "ltx-cue-C03-Q01"
  };
  assert.equal(isLtxDialogueCue(intent), true);
  const posts = [];
  const fetchImpl = async (url, init = {}) => {
    posts.push({ url, body: init.body });
    return { ok: true, json: async () => ({}) };
  };
  const result = await attachForIntent(store, intent, { id: "take-1", name: "David take", file: "david.wav", activeVersion: 1 }, fetchImpl);
  assert.equal(result.kind, "ltx-dialogue-cue");
  assert.equal(result.cueId, "C03-Q01");
  assert.equal(result.returnFocusId, "ltx-cue-C03-Q01");
  assert.equal(store.calls.some((call) => call[0] === "saveStoryboardDirection"), false);
  assert.equal(store.calls.some((call) => call[0] === "replaceStoryboardReferences"), false);
  assert.match(String(posts[0].body), /C03-Q01/);
});


test("CHR-008 empty voice offers character cue lines, not enrollment", () => {
  const lines = cueLinesForCharacter("David", {
    clips: { "H04-S13-C03": { speaker: "David", dialogueAnchor: "Father, into your hands." } },
    segments: { "seg-1": { speaker: "David", dialogueAnchor: "It is finished." }, "seg-2": { speaker: "Voice of Hell", dialogueAnchor: "The hour has come." } }
  });
  assert.deepEqual(lines, ["Father, into your hands.", "It is finished."]);
  assert.equal(lines.includes("The hour has come."), false);
});

test("CHR-006 generate-from-character keeps bible continuity locks", async () => {
  const store = mockStore();
  store.generateAsset = async (id) => { store.calls.push(["generateAsset", id]); };
  const locks = ["iron collar locked", "wrists bound"];
  assert.match(withContinuityLocks("David sheet", locks), /CONTINUITY LOCKS/);
  assert.deepEqual(locksFromBundle({ primaryAsset: { continuity: locks } }), locks);
  await generateForIntent(store, {
    sourceEntity: { type: "character", id: "character-david", label: "David" },
    requirement: { relationship: "character.primaryAppearance", category: "character" },
    prefill: { name: "David", prompt: "Production identity sheet for David.", continuity: locks, continuityLocks: locks }
  }, { prompt: "Production identity sheet for David.", continuity: locks, attachAfter: false });
  const patch = store.calls.find((call) => call[0] === "patchAsset");
  assert.ok(patch);
  assert.deepEqual(patch[2].continuity, locks);
  assert.match(patch[2].prompt, /iron collar locked/);
});
