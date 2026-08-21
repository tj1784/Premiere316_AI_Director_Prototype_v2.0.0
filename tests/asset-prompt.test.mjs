import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTPUT_MODES,
  assetAliases,
  buildAssetMentionOptions,
  buildAssetPromptPayload,
  createAssetPin,
  defaultReferenceRole,
  describeReferenceApplication,
  filterCompatibleWorkflows,
  filterMentionOptions,
  filterSpeakerReferenceOptions,
  getWorkflowComposerContract,
  mentionQueryAtCaret,
  normalizeAssetHandlePart,
  normalizeMentionKey,
  parseMentionTokens,
  primaryAssetAlias,
  reconcileMentionPins,
  removeMentionToken,
  replaceMentionAtCaret,
  resolveMentionToken,
  validateAssetPrompt,
  workflowCompatibleWithMode,
  workflowIsReady
} from "../client/src/asset-prompt.js";

const adam = {
  id: "character-adam-first-man-freed-appearance",
  name: "ADAM - First Man Freed",
  variant: "Appearance",
  category: "character",
  categoryLabel: "Characters",
  mediaType: "image",
  activeVersion: 3,
  versions: [
    { v: 2, file: "character_adam.v2.png" },
    { v: 3, file: "character_adam.v3.png" }
  ],
  approvalCurrent: true,
  aliases: ["first_man"]
};

const adamVoice = {
  id: "voice-adam-voice-design",
  name: "ADAM - Voice Design",
  variant: "Voice Design",
  category: "voice",
  categoryLabel: "Voices",
  mediaType: "audio",
  activeVersion: 2,
  versions: [{ v: 2, file: "voice_adam.v2.wav" }],
  approval: { status: "approved", activeVersion: 2 }
};

const eve = {
  id: "character-eve-first-woman-freed-appearance",
  name: "EVE - First Woman Freed",
  variant: "Appearance",
  category: "character",
  categoryLabel: "Characters",
  mediaType: "image",
  activeVersion: 4,
  versions: [{ v: 4, files: ["character_eve.v4.png"] }],
  approvalCurrent: false
};

const dungeon = {
  id: "location-dungeon-primary",
  name: "Dungeon - Primary Environment",
  variant: "Production Reference",
  category: "location",
  categoryLabel: "Locations",
  mediaType: "image",
  activeVersion: 1,
  versions: [{ v: 1, file: "location_dungeon.v1.webp" }]
};

const ghost = {
  id: "character-ghost",
  name: "Ghost",
  variant: "Appearance",
  category: "character",
  categoryLabel: "Characters",
  mediaType: "image",
  activeVersion: 0,
  versions: []
};

const assets = [adamVoice, dungeon, ghost, eve, adam];
const mentionOptions = buildAssetMentionOptions(assets);

const workflows = [
  { id: "flux-image", label: "FLUX Style-Lock Still", mediaType: "image", purpose: "Generate a still", ready: true, availableNow: true },
  { id: "ltx-video", label: "LTX 2.5 Image to Video", mediaType: "video", purpose: "Generate motion", ready: true, availableNow: true },
  { id: "ltx-video-missing", label: "LTX Video Experimental", mediaType: "video", ready: false, reason: "LTX model missing" },
  { id: "qwen-voice", label: "Qwen Voice Design", mediaType: "audio", purpose: "Design a voice", ready: true, availableNow: true },
  { id: "dialogue-tts", label: "Character Dialogue TTS", mediaType: "audio", purpose: "Spoken dialogue", ready: true, availableNow: true },
  { id: "graphic-design", label: "Title Card Design", mediaType: "graphic", purpose: "Design a graphic", ready: true, availableNow: true },
  { id: "ace-music", label: "ACE Music and Sound", mediaType: "audio", purpose: "Generate audio", ready: true, availableNow: true },
  { id: "declared-design", label: "Special Art Pass", mediaType: "unknown", supportedOutputModes: ["design"], ready: true, availableNow: true }
];

const voiceDesignWorkflow = {
  id: "voice-design-schema",
  label: "Qwen Voice Design",
  supportedOutputModes: ["voice-design"],
  ready: true,
  availableNow: true,
  composerSchema: {
    referenceApplication: "association-only",
    primaryPrompt: { key: "voiceInstruction", label: "Voice instruction", required: true },
    fields: [
      { key: "sampleText", type: "textarea", label: "Audition line", required: true },
      { key: "language", type: "select", label: "Language", enum: ["English", "Spanish"], default: "English" }
    ]
  },
  optionSchema: { properties: { sampleText: { type: "string", maxLength: 20_000 } } }
};

const dialogueWorkflow = {
  id: "dialogue-schema",
  label: "IndexTTS Dialogue",
  supportedOutputModes: ["dialogue"],
  ready: true,
  availableNow: true,
  referencePolicy: { minimum: 1, maximum: 1, acceptedMediaTypes: ["audio"], acceptedRoles: ["voice"], acceptedAssetIds: [adamVoice.id] },
  composerSchema: {
    referenceApplication: "provider-conditioning",
    primaryPrompt: { key: "performanceDirection", label: "Performance direction", required: true },
    fields: [{ key: "dialogueText", type: "textarea", label: "Exact dialogue", required: true }],
    speakerReference: { required: true, acceptedAssetIds: [adamVoice.id] }
  }
};

const audioWorkflow = {
  id: "stable-audio-schema",
  label: "Stable Audio Hybrid",
  supportedOutputModes: ["audio"],
  ready: true,
  availableNow: true,
  composerSchema: {
    referenceApplication: "prompt-context-only",
    primaryPrompt: { key: "prompt", label: "Audio prompt", required: true },
    fields: [
      { key: "audioCategory", type: "select", label: "Category", enum: ["music", "sound-effect", "foley", "ambience"], required: true },
      { key: "lyrics", type: "textarea", label: "Lyrics", required: false },
      { key: "durationSec", type: "number", label: "Duration", min: 1, max: 380, step: 0.01, default: 30, required: true }
    ]
  },
  optionSchema: {
    properties: {
      durationSec: { type: "number", minimum: 1, maximum: 380, multipleOf: 0.01, default: 30 }
    }
  }
};

test("output modes expose the complete cross-media composer contract", () => {
  assert.deepEqual(OUTPUT_MODES.map((mode) => mode.id), ["image", "video", "voice-design", "dialogue", "design", "audio"]);
  assert.equal(OUTPUT_MODES.find((mode) => mode.id === "video").usesDuration, true);
  assert.equal(OUTPUT_MODES.find((mode) => mode.id === "voice-design").usesDuration, false);
  assert.equal(OUTPUT_MODES.find((mode) => mode.id === "dialogue").usesDuration, false);
  assert.equal(OUTPUT_MODES.find((mode) => mode.id === "audio").usesDuration, false);
  assert.equal(OUTPUT_MODES.find((mode) => mode.id === "audio").usesAspect, false);
});

test("handle normalization preserves friendly @Adam semantics", () => {
  assert.equal(normalizeMentionKey("@Adam's Look.png"), "adams_look_png");
  assert.equal(normalizeAssetHandlePart("ADAM - First Man"), "AdamFirstMan");
  assert.equal(primaryAssetAlias(adam), "ADAM");
  assert.equal(defaultReferenceRole(adam), "identity");
  assert.equal(defaultReferenceRole(adamVoice), "voice");
});

test("colliding semantic names get deterministic category-suffixed handles", () => {
  const options = buildAssetMentionOptions([adamVoice, adam]);
  const character = options.find((option) => option.assetId === adam.id);
  const voice = options.find((option) => option.assetId === adamVoice.id);
  assert.equal(character.handle, "@Adam");
  assert.equal(voice.handle, "@Adam_Voice");
  assert.equal(new Set(options.map((option) => option.handleKey)).size, options.length);
});

test("mention options expose aliases, media previews, and exact active files", () => {
  const character = mentionOptions.find((option) => option.assetId === adam.id);
  const voice = mentionOptions.find((option) => option.assetId === adamVoice.id);
  assert.ok(assetAliases(adam).includes("character_adam_png"));
  assert.ok(character.aliases.includes("character_adam_png"));
  assert.equal(character.activeVersion, 3);
  assert.equal(character.activeFile, "character_adam.v3.png");
  assert.equal(character.previewType, "image");
  assert.equal(character.approved, true);
  assert.equal(voice.activeFile, "voice_adam.v2.wav");
  assert.equal(voice.previewType, "audio");
  assert.equal(voice.approved, true);
});

test("canonical handles and file-style aliases resolve to the same exact asset", () => {
  const canonical = resolveMentionToken("@Adam", mentionOptions);
  const fileAlias = resolveMentionToken("@character_Adam.png", mentionOptions);
  const voice = resolveMentionToken("@Adam_Voice", mentionOptions);
  assert.equal(canonical.status, "resolved");
  assert.equal(canonical.option.assetId, adam.id);
  assert.equal(fileAlias.status, "resolved");
  assert.equal(fileAlias.option.assetId, adam.id);
  assert.equal(voice.status, "resolved");
  assert.equal(voice.option.assetId, adamVoice.id);
  assert.equal(resolveMentionToken("@Nobody", mentionOptions).status, "unresolved");
});

test("parser finds prompt mentions without treating email addresses as assets", () => {
  const prompt = "Email adam@example.com, then frame (@Adam), @Eve in @location_Dungeon.png. Finish with @";
  const tokens = parseMentionTokens(prompt);
  assert.deepEqual(tokens.map((token) => token.raw), ["@Adam", "@Eve", "@location_Dungeon.png", "@"]);
  assert.deepEqual(tokens.map((token) => token.complete), [true, true, true, false]);
  assert.equal(tokens[2].key, "location_dungeon_png");
});

test("caret query and insertion helpers support keyboard typeahead", () => {
  const prompt = "Show @Ad";
  assert.deepEqual(mentionQueryAtCaret(prompt, prompt.length), {
    start: 5,
    end: 8,
    raw: "@Ad",
    query: "Ad"
  });
  const replacement = replaceMentionAtCaret(prompt, prompt.length, "@Adam");
  assert.equal(replacement.text, "Show @Adam");
  assert.equal(replacement.caret, replacement.text.length);
  assert.equal(mentionQueryAtCaret("adam@example.com", 7), null);
});

test("mention removal cleans spacing and punctuation", () => {
  assert.equal(removeMentionToken("@Adam dancing with @Eve in @Dungeon.", "@Eve"), "@Adam dancing with in @Dungeon.");
  assert.equal(removeMentionToken("A portrait of @Adam, at dawn", "@Adam"), "A portrait of, at dawn");
});

test("suggestion filtering is query-aware and media-aware", () => {
  const imageSuggestions = filterMentionOptions(mentionOptions, { outputMode: "image", limit: 20 });
  const voiceSuggestions = filterMentionOptions(mentionOptions, { outputMode: "voice-design", limit: 20 });
  const queried = filterMentionOptions(mentionOptions, { outputMode: "video", query: "dung", limit: 20 });
  assert.equal(imageSuggestions[0].previewType, "image");
  assert.equal(voiceSuggestions[0].assetId, adamVoice.id);
  assert.deepEqual(queried.map((option) => option.assetId), [dungeon.id]);

  const audioOnlyWorkflow = { referenceMediaTypes: ["audio"] };
  const audioOnly = filterMentionOptions(mentionOptions, { outputMode: "dialogue", workflow: audioOnlyWorkflow, limit: 20 });
  assert.deepEqual(audioOnly.map((option) => option.assetId), [adamVoice.id]);

  const exactAssetWorkflow = { referencePolicy: { acceptedAssetIds: [dungeon.id] } };
  const exactAssetOnly = filterMentionOptions(mentionOptions, { outputMode: "image", workflow: exactAssetWorkflow, limit: 20 });
  assert.deepEqual(exactAssetOnly.map((option) => option.assetId), [dungeon.id]);
  assert.deepEqual(filterMentionOptions(mentionOptions, {
    outputMode: "image",
    workflow: { referencePolicy: { acceptedAssetIds: [] } },
    limit: 20
  }), []);
});

test("workflow compatibility covers every mode and honors explicit declarations", () => {
  assert.equal(workflowCompatibleWithMode(workflows[0], "image"), true);
  assert.equal(workflowCompatibleWithMode(workflows[0], "video"), false);
  assert.equal(workflowCompatibleWithMode(workflows[1], "video"), true);
  assert.equal(workflowCompatibleWithMode(workflows[3], "voice design"), true);
  assert.equal(workflowCompatibleWithMode(workflows[4], "dialogue"), true);
  assert.equal(workflowCompatibleWithMode(workflows[5], "design"), true);
  assert.equal(workflowCompatibleWithMode(workflows[6], "audio"), true);
  assert.equal(workflowCompatibleWithMode(workflows[7], "design"), true);
  assert.equal(workflowCompatibleWithMode(workflows[7], "image"), false);
});

test("workflow filtering retains unavailable choices for explanation and can return ready-only choices", () => {
  const unchecked = { id: "ltx-unchecked", label: "LTX Unchecked", mediaType: "video", ready: null, availableNow: null };
  const allVideo = filterCompatibleWorkflows([...workflows, unchecked], "video", { includeUnavailable: true });
  const readyVideo = filterCompatibleWorkflows([...workflows, unchecked], "video", { includeUnavailable: false });
  assert.deepEqual(allVideo.map((workflow) => workflow.id), ["ltx-video", "ltx-unchecked", "ltx-video-missing"]);
  assert.deepEqual(readyVideo.map((workflow) => workflow.id), ["ltx-video"]);
  assert.equal(workflowIsReady(unchecked), false);
  assert.equal(workflowIsReady({ ready: true, availableNow: true }), true);
  assert.deepEqual(filterCompatibleWorkflows([], "video", { includeUnavailable: true }), []);
});

test("pins preserve exact version and file even when the library active version advances", () => {
  const originalPins = reconcileMentionPins("@Adam dancing", [], mentionOptions);
  assert.equal(originalPins.length, 1);
  assert.equal(originalPins[0].assetVersion, 3);
  assert.equal(originalPins[0].file, "character_adam.v3.png");

  const advancedAdam = {
    ...adam,
    activeVersion: 4,
    versions: [...adam.versions, { v: 4, file: "character_adam.v4.png" }]
  };
  const refreshedOptions = buildAssetMentionOptions([advancedAdam, adamVoice, eve, dungeon]);
  const preserved = reconcileMentionPins("@Adam dancing", originalPins, refreshedOptions);
  assert.equal(preserved[0].assetVersion, 3);
  assert.equal(preserved[0].file, "character_adam.v3.png");
  assert.equal(createAssetPin(refreshedOptions.find((option) => option.assetId === adam.id)).assetVersion, 4);
});

test("reconciliation follows prompt order, de-duplicates a repeated asset, and keeps roles", () => {
  const original = reconcileMentionPins("@Eve beside @Adam and @Adam", [], mentionOptions);
  assert.deepEqual(original.map((pin) => pin.assetId), [eve.id, adam.id]);
  const customized = original.map((pin) => pin.assetId === eve.id ? { ...pin, role: "wardrobe" } : pin);
  const reconciled = reconcileMentionPins("@Eve beside @Adam", customized, mentionOptions);
  assert.equal(reconciled[0].role, "wardrobe");
});

test("validation reports unresolved, ambiguous, unavailable, and incomplete references", () => {
  const unresolved = validateAssetPrompt({
    prompt: "@Adam meets @Unknown and @",
    outputMode: "image",
    workflowId: "flux-image",
    workflows,
    mentionOptions,
    aspectRatio: "16:9"
  });
  assert.equal(unresolved.valid, false);
  assert.deepEqual(unresolved.unresolved, ["@Unknown", "@"]);

  const unavailable = validateAssetPrompt({
    prompt: "Render @Ghost",
    outputMode: "image",
    workflowId: "flux-image",
    workflows,
    mentionOptions,
    aspectRatio: "16:9"
  });
  assert.ok(unavailable.errors.some((error) => error.includes("no active generated file")));

  const ambiguousAssets = [
    { ...eve, id: "character-one", name: "One", aliases: ["mystery"] },
    { ...dungeon, id: "location-two", name: "Two", aliases: ["mystery"] }
  ];
  const ambiguousOptions = buildAssetMentionOptions(ambiguousAssets);
  const ambiguous = validateAssetPrompt({
    prompt: "Show @mystery",
    outputMode: "image",
    workflowId: "flux-image",
    workflows,
    mentionOptions: ambiguousOptions,
    aspectRatio: "16:9"
  });
  assert.equal(ambiguous.ambiguous.length, 1);
  assert.equal(ambiguous.ambiguous[0].candidates.length, 2);

  const approvalBlocked = validateAssetPrompt({
    prompt: "Show @Eve",
    outputMode: "image",
    workflowId: "flux-image",
    workflows,
    mentionOptions,
    aspectRatio: "16:9",
    requireApprovedReferences: true
  });
  assert.ok(approvalBlocked.errors.some((error) => error.includes("must be approved")));
});

test("validation requires an explicit, compatible, ready workflow", () => {
  const base = { prompt: "@Adam dancing", outputMode: "video", workflows, mentionOptions, aspectRatio: "16:9", durationSec: 8 };
  assert.ok(validateAssetPrompt(base).errors.includes("Select a generation workflow."));
  assert.ok(validateAssetPrompt({ ...base, workflowId: "flux-image" }).errors.some((error) => error.includes("not compatible")));
  assert.ok(validateAssetPrompt({ ...base, workflowId: "ltx-video-missing" }).errors.includes("LTX model missing"));
  assert.equal(validateAssetPrompt({ ...base, workflowId: "ltx-video" }).valid, true);
  const unchecked = { id: "unchecked-video", label: "Unchecked Video", supportedOutputModes: ["video"], ready: null, availableNow: null };
  const uncheckedValidation = validateAssetPrompt({ ...base, workflowId: unchecked.id, workflows: [unchecked] });
  assert.ok(uncheckedValidation.errors.some((error) => error.includes("current readiness check")));
});

test("validation mirrors curated workflow reference count, media, and role policy", () => {
  const exactWorkflow = {
    id: "exact-image",
    label: "Exact image",
    supportedOutputModes: ["image"],
    ready: true,
    availableNow: true,
    referencePolicy: { minimum: 1, maximum: 1, acceptedMediaTypes: ["image"], acceptedRoles: ["identity"] }
  };
  const catalog = [exactWorkflow];
  const noReference = validateAssetPrompt({ prompt: "A portrait", outputMode: "image", workflowId: exactWorkflow.id, workflows: catalog, mentionOptions, aspectRatio: "16:9" });
  assert.ok(noReference.errors.some((error) => error.includes("requires at least 1")));
  const wrongRole = validateAssetPrompt({
    prompt: "A portrait of @Adam",
    outputMode: "image",
    workflowId: exactWorkflow.id,
    workflows: catalog,
    mentionOptions,
    pins: reconcileMentionPins("A portrait of @Adam", [], mentionOptions).map((pin) => ({ ...pin, role: "voice" })),
    aspectRatio: "16:9"
  });
  assert.ok(wrongRole.errors.some((error) => error.includes("cannot use the voice role")));
  const audioReference = validateAssetPrompt({
    prompt: "A portrait of @Adam_Voice",
    outputMode: "image",
    workflowId: exactWorkflow.id,
    workflows: catalog,
    mentionOptions,
    aspectRatio: "16:9"
  });
  assert.ok(audioReference.errors.some((error) => error.includes("this workflow accepts image")));

  const acceptedAssetWorkflow = {
    ...exactWorkflow,
    id: "accepted-id-image",
    referencePolicy: { ...exactWorkflow.referencePolicy, acceptedAssetIds: [dungeon.id] }
  };
  const rejectedAsset = validateAssetPrompt({
    prompt: "A portrait of @Adam",
    outputMode: "image",
    workflowId: acceptedAssetWorkflow.id,
    workflows: [acceptedAssetWorkflow],
    mentionOptions,
    aspectRatio: "16:9"
  });
  assert.ok(rejectedAsset.errors.some((error) => error.includes("not an eligible asset")));
});

test("duration and aspect settings are validated for the selected output mode", () => {
  const missingAspect = validateAssetPrompt({ prompt: "A still", outputMode: "image", workflowId: "flux-image", workflows, aspectRatio: "" });
  const badDuration = validateAssetPrompt({ prompt: "A shot", outputMode: "video", workflowId: "ltx-video", workflows, aspectRatio: "16:9", durationSec: 0 });
  const excessiveDuration = validateAssetPrompt({ prompt: "A sound", outputMode: "audio", workflowId: audioWorkflow.id, workflows: [audioWorkflow], options: { audioCategory: "foley" }, durationSec: 4000 });
  assert.ok(missingAspect.errors.some((error) => error.includes("aspect ratio")));
  assert.ok(badDuration.errors.some((error) => error.includes("positive duration")));
  assert.ok(excessiveDuration.errors.includes("Duration cannot exceed 3600 seconds."));
  const constrainedVideo = {
    id: "constrained-video",
    label: "Constrained Video",
    supportedOutputModes: ["video"],
    ready: true,
    availableNow: true,
    optionSchema: { properties: { durationSec: { minimum: 1, maximum: 180 } } }
  };
  const tooShort = validateAssetPrompt({ prompt: "A short shot", outputMode: "video", workflowId: constrainedVideo.id, workflows: [constrainedVideo], aspectRatio: "16:9", durationSec: 0.5 });
  assert.ok(tooShort.errors.includes("Constrained Video requires at least 1 second."));
});

test("payload separates visible prompt text from exact asset pins", () => {
  const prompt = "@Adam dancing with @Eve in the @Dungeon";
  const draftPins = reconcileMentionPins(prompt, [], mentionOptions).map((pin) => pin.assetId === eve.id ? { ...pin, role: "wardrobe" } : pin);
  const payload = buildAssetPromptPayload({
    prompt,
    outputMode: "video",
    workflowId: "ltx-video",
    workflows,
    mentionOptions,
    pins: draftPins,
    aspectRatio: "2.39:1",
    durationSec: 12
  });

  assert.equal(payload.schema, "premiere316.asset-prompt.v1");
  assert.equal(payload.outputMode, "video");
  assert.equal(payload.outputLabel, "Video");
  assert.equal(payload.workflowId, "ltx-video");
  assert.equal(payload.prompt, prompt);
  assert.deepEqual(payload.settings, { aspectRatio: "2.39:1", durationSec: 12 });
  assert.deepEqual(payload.references.map((reference) => ({
    assetId: reference.assetId,
    assetVersion: reference.assetVersion,
    role: reference.role,
    file: reference.file,
    order: reference.order
  })), [
    { assetId: adam.id, assetVersion: 3, role: "identity", file: "character_adam.v3.png", order: 1 },
    { assetId: eve.id, assetVersion: 4, role: "wardrobe", file: "character_eve.v4.png", order: 2 },
    { assetId: dungeon.id, assetVersion: 1, role: "location", file: "location_dungeon.v1.webp", order: 3 }
  ]);
});

test("payload emits only workflow-advertised settings and never adds fake voice duration", () => {
  const image = buildAssetPromptPayload({
    prompt: "A quiet room",
    outputMode: "image",
    workflowId: "flux-image",
    workflows,
    aspectRatio: "4:3",
    durationSec: 99
  });
  const voice = buildAssetPromptPayload({
    prompt: "Warm and weathered",
    outputMode: "voice-design",
    workflowId: voiceDesignWorkflow.id,
    workflows: [voiceDesignWorkflow],
    options: { sampleText: "The hour has come." },
    durationSec: 99
  });
  assert.deepEqual(image.settings, { aspectRatio: "4:3" });
  assert.deepEqual(voice.settings, {});
  assert.deepEqual(voice.options, {
    sampleText: "The hour has come.",
    language: "English",
    voiceInstruction: "Warm and weathered"
  });
});

test("composer contracts expose separate audition and dialogue fields", () => {
  const voiceContract = getWorkflowComposerContract(voiceDesignWorkflow, "voice-design");
  const dialogueContract = getWorkflowComposerContract(dialogueWorkflow, "dialogue");
  assert.equal(voiceContract.primaryPrompt.key, "voiceInstruction");
  assert.deepEqual(voiceContract.fields.map((field) => field.key), ["sampleText", "language"]);
  assert.equal(voiceContract.fields.some((field) => field.key === "durationSec"), false);
  assert.equal(voiceContract.referenceApplication, "association-only");
  assert.equal(dialogueContract.primaryPrompt.key, "performanceDirection");
  assert.deepEqual(dialogueContract.fields.map((field) => field.key), ["dialogueText"]);
  assert.equal(dialogueContract.speakerReference.required, true);
  assert.equal(dialogueContract.referenceApplication, "provider-conditioning");
});

test("reference application semantics are preserved and described honestly", () => {
  assert.deepEqual(describeReferenceApplication("prompt-context-only"), {
    id: "prompt-context-only",
    label: "Prompt context only",
    description: "Pinned assets add bounded text context to the audio prompt; their media is not sent as model conditioning."
  });
  assert.match(describeReferenceApplication("association-only").description, /does not condition the audio/);
  assert.match(describeReferenceApplication("provider-conditioning").description, /explicitly linked provider voice/);
  const fallbackContract = getWorkflowComposerContract({ referencePolicy: { application: "association-only" } }, "voice-design");
  assert.equal(fallbackContract.referenceApplication, "association-only");
  const unknown = describeReferenceApplication("future-reference-mode");
  assert.equal(unknown.id, "future-reference-mode");
  assert.match(unknown.description, /future-reference-mode/);
});

test("dialogue requires exact text and one eligible approved voice pin", () => {
  const characterOnly = validateAssetPrompt({
    prompt: "@Adam speaks softly",
    outputMode: "dialogue",
    workflowId: dialogueWorkflow.id,
    workflows: [dialogueWorkflow],
    mentionOptions,
    options: { dialogueText: "We leave before dawn." }
  });
  assert.ok(characterOnly.errors.some((error) => error.includes("Choose one approved speaker voice")));

  const voiceOption = mentionOptions.find((option) => option.assetId === adamVoice.id);
  assert.deepEqual(filterSpeakerReferenceOptions(mentionOptions, dialogueWorkflow, "dialogue").map((option) => option.assetId), [adamVoice.id]);
  assert.deepEqual(filterSpeakerReferenceOptions(mentionOptions, {
    ...dialogueWorkflow,
    composerSchema: { ...dialogueWorkflow.composerSchema, speakerReference: { required: true, acceptedAssetIds: [] } }
  }, "dialogue"), []);
  const payload = buildAssetPromptPayload({
    prompt: "Quiet, urgent delivery",
    outputMode: "dialogue",
    workflowId: dialogueWorkflow.id,
    workflows: [dialogueWorkflow],
    mentionOptions,
    options: { dialogueText: "We leave before dawn." },
    speakerReference: createAssetPin(voiceOption)
  });
  assert.equal(payload.options.dialogueText, "We leave before dawn.");
  assert.equal(payload.options.performanceDirection, "Quiet, urgent delivery");
  assert.deepEqual({
    assetId: payload.speakerReference.assetId,
    assetVersion: payload.speakerReference.assetVersion,
    file: payload.speakerReference.file,
    role: payload.speakerReference.role
  }, {
    assetId: adamVoice.id,
    assetVersion: 2,
    file: "voice_adam.v2.wav",
    role: "voice"
  });
});

test("audio fields use advertised category, duration default, bounds, and step", () => {
  const missingCategory = validateAssetPrompt({
    prompt: "Distant chains",
    outputMode: "audio",
    workflowId: audioWorkflow.id,
    workflows: [audioWorkflow]
  });
  assert.ok(missingCategory.errors.includes("Enter category."));

  const steppedWrong = validateAssetPrompt({
    prompt: "Distant chains",
    outputMode: "audio",
    workflowId: audioWorkflow.id,
    workflows: [audioWorkflow],
    options: { audioCategory: "foley" },
    durationSec: 1.005
  });
  assert.ok(steppedWrong.errors.includes("Duration must use increments of 0.01."));

  const payload = buildAssetPromptPayload({
    prompt: "Distant chains",
    outputMode: "audio",
    workflowId: audioWorkflow.id,
    workflows: [audioWorkflow],
    options: { audioCategory: "ambience", lyrics: "" }
  });
  assert.deepEqual(payload.options, { audioCategory: "ambience", durationSec: 30 });
  assert.deepEqual(payload.settings, { durationSec: 30 });
});

test("payload construction refuses unavailable workflows and unresolved tokens", () => {
  assert.throws(
    () => buildAssetPromptPayload({ prompt: "@Adam runs", outputMode: "video", workflowId: "ltx-video-missing", workflows, mentionOptions, aspectRatio: "16:9", durationSec: 8 }),
    (error) => error.validation?.valid === false && /LTX model missing/.test(error.message)
  );
  assert.throws(
    () => buildAssetPromptPayload({ prompt: "@Nobody runs", outputMode: "video", workflowId: "ltx-video", workflows, mentionOptions, aspectRatio: "16:9", durationSec: 8 }),
    /Resolve @Nobody/
  );
});
