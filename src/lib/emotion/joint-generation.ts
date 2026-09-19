import type { PerformanceDraft } from "./integration.ts";
import { serializePerformance } from "./serializers.ts";
import type { VoiceReferenceManifest } from "../studio/voice-reference.ts";

export type ApiWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type SpeakerReference = {
  speaker: string;
  binding: string;
  imageNodeId: string;
  audioNodeId: string;
  imageSha256: string;
  audioSha256: string;
};
export type JointWorkflowMode = "h3-ref2va" | "h3-fl2va" | "ltx-supplied-audio" | "ltx-director";
export function jointCapability(mode: JointWorkflowMode) {
  if (mode === "h3-ref2va")
    return {
      supported: true,
      reason:
        "Requires the installed MiniMaxH3ReferenceToVideo node, Ref2VA model, verified image/audio loaders and a connected audiovisual output.",
    };
  return {
    supported: false,
    reason:
      mode === "h3-fl2va"
        ? "H3 FL2VA uses first/last frames; this mode cannot establish voice identity through Ref2VA inputs."
        : "LTX supplied-audio conditioning is a soundtrack input, not a verified voice-identity-only input. This joint speech/reference path is unsupported.",
  };
}
/** Pure request construction only. Callers must verify uploaded bytes and live node/model schemas before submission. */
export function mapJointPerformanceRequest(input: {
  mode: JointWorkflowMode;
  workflow: ApiWorkflow;
  conditioningNodeId: string;
  draft: PerformanceDraft;
  lineIds: string[];
  manifest: VoiceReferenceManifest;
  references: SpeakerReference[];
  basePrompt: string;
}) {
  const capability = jointCapability(input.mode);
  if (!capability.supported) throw new Error(capability.reason);
  const graph = structuredClone(input.workflow),
    node = graph[input.conditioningNodeId];
  if (node?.class_type !== "MiniMaxH3ReferenceToVideo")
    throw new Error("Use an actual H3 Ref2VA conditioning node.");
  if (!input.lineIds.length || new Set(input.lineIds).size !== input.lineIds.length)
    throw new Error("Select a bounded set of dialogue lines once each.");
  const lines = input.draft.compiled.filter((l) => input.lineIds.includes(l.line_id));
  if (lines.length !== input.lineIds.length) throw new Error("Unknown dialogue line.");
  const speakers = [...new Set(lines.map((l) => l.character_id))];
  if (
    input.references.length !== speakers.length ||
    input.references.length > 3 ||
    new Set(input.references.map((r) => r.speaker)).size !== speakers.length
  )
    throw new Error("Assign exactly one image and voice reference to each speaker, up to three.");
  if (Object.keys(node.inputs).some((k) => /^ref_(?:image|audio|video)/.test(k)))
    throw new Error(
      "Existing reference inputs must be reviewed and explicitly cleared before applying new bindings.",
    );
  let seconds = 0;
  const bindings = input.references.map((reference, index) => {
    if (!speakers.includes(reference.speaker))
      throw new Error("Reference speaker is not in the selected dialogue.");
    const selected = input.manifest.references.find((r) => r.binding === reference.binding);
    if (
      !selected ||
      selected.reference.audio?.sha256 !== reference.audioSha256 ||
      selected.reference.status !== "APPROVED" ||
      selected.reference.conflicts?.length
    )
      throw new Error("Voice binding is unapproved, missing, conflicted or changed.");
    const duration = selected.reference.audio.durationSec;
    if (!Number.isFinite(duration) || !duration || duration <= 0)
      throw new Error("Verify reference duration before generation.");
    seconds += duration;
    if (!/^[a-f0-9]{64}$/.test(reference.imageSha256))
      throw new Error("Verify the approved image bytes.");
    if (
      graph[reference.audioNodeId]?.class_type !== "LoadAudio" ||
      typeof graph[reference.audioNodeId].inputs.audio !== "string" ||
      graph[reference.imageNodeId]?.class_type !== "LoadImage" ||
      typeof graph[reference.imageNodeId].inputs.image !== "string"
    )
      throw new Error(
        "Reference media must use explicit executable LoadAudio and LoadImage nodes.",
      );
    const ordinal = index + 1;
    node.inputs[`ref_audios.ref_audio_${index}`] = [reference.audioNodeId, 0];
    node.inputs[`ref_images.ref_image_${index}`] = [reference.imageNodeId, 0];
    return {
      speaker: reference.speaker,
      audioTag: `<Audio ${ordinal}>`,
      imageTag: `<Picture ${ordinal}>`,
      iterationId: selected.iterationId,
      audioSha256: reference.audioSha256,
      imageSha256: reference.imageSha256,
    };
  });
  if (seconds > 15)
    throw new Error(
      "H3 Ref2VA supports at most 15 seconds of reference audio in total. Prepare and approve a shorter reference; it will not be trimmed automatically.",
    );
  const serialized = serializePerformance({
    profile: "h3-ref2va-1",
    lines,
    basePrompt: input.basePrompt,
    speakers: Object.fromEntries(
      bindings.map((r) => [
        r.speaker,
        {
          label: input.draft.config.character_baselines[r.speaker].label,
          language: input.draft.config.character_baselines[r.speaker].voice_baseline?.language,
          imageTag: r.imageTag,
          audioTag: r.audioTag,
        },
      ]),
    ),
  });
  node.inputs.prompt = serialized.text;
  return {
    serializer: serialized.profile,
    unsupported_controls: serialized.unsupported_controls,
    workflow: graph,
    bindings,
    dialogue: lines.map((l) => ({
      lineId: l.line_id,
      speaker: l.character_id,
      text: l.spoken_text,
    })),
    purpose: "joint_speech_video" as const,
    requiresLiveWorkflowReview: true as const,
  };
}
