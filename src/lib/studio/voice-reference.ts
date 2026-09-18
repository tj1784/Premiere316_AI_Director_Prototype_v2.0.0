import type { Picture } from "./types.ts";
import {
  allCharacterVoiceIterations,
  resolveCharacterVoice,
  voiceBindingKey,
  type CharacterVoiceIteration,
} from "./character-voice-designs.ts";

export async function inspectVoiceBytes(bytes: ArrayBuffer) {
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    const view = new DataView(bytes);
    let sampleRate: number | undefined;
    if (
      bytes.byteLength >= 44 &&
      view.getUint32(0, false) === 0x52494646 &&
      view.getUint32(8, false) === 0x57415645
    ) {
      for (let offset = 12; offset + 8 <= bytes.byteLength;) {
        const size = view.getUint32(offset + 4, true);
        if (
          view.getUint32(offset, false) === 0x666d7420 &&
          size >= 16 &&
          offset + 24 <= bytes.byteLength
        ) {
          sampleRate = view.getUint32(offset + 12, true);
          break;
        }
        offset += 8 + size + (size % 2);
      }
    }
    return {
      sha256,
      bytes: bytes.byteLength,
      durationSec: decoded.duration,
      ...(sampleRate ? { sampleRate } : {}),
      channels: decoded.numberOfChannels,
    };
  } finally {
    await context.close();
  }
}
export async function verifyVoiceReference(picture: Picture, id: string): Promise<Picture> {
  const voice = allCharacterVoiceIterations(picture).find((v) => v.id === id);
  if (!voice?.audio) throw new Error("Voice audio is missing.");
  const response = await fetch(voice.audio.previewUri ?? voice.audio.mediaUri);
  if (!response.ok) throw new Error("Voice recording could not be read.");
  const metadata = await inspectVoiceBytes(await response.arrayBuffer());
  if (voice.audio.sha256 && voice.audio.sha256 !== metadata.sha256)
    throw new Error("Recording hash changed. Import it as a new iteration before approval.");
  const state = picture.characterVoiceDesigns!;
  return {
    ...picture,
    characterVoiceDesigns: {
      ...state,
      profiles: state.profiles.map((p) =>
        p.attachmentId !== id
          ? p
          : { ...p, memberId: voice.memberId, sample: { ...p.sample, ...metadata } },
      ),
      iterations: state.iterations?.map((p) =>
        p.id !== id ? p : { ...p, audio: { ...p.audio!, ...metadata } },
      ),
    },
  };
}
export type VoiceReferenceManifest = {
  schemaVersion: 1;
  kind: "identity_reference";
  pictureId: string;
  exportedAt: number;
  references: Array<{
    binding: string;
    characterId: string;
    memberId?: string;
    iterationId: string;
    approvalRevision: number;
    reference: CharacterVoiceIteration;
  }>;
  issues: Array<{ binding: string; reason: string }>;
};
export function exportVoiceReferences(picture: Picture, now = Date.now()): VoiceReferenceManifest {
  const references: VoiceReferenceManifest["references"] = [],
    issues: VoiceReferenceManifest["issues"] = [];
  const bindings = new Map(
    allCharacterVoiceIterations(picture).map((v) => [
      voiceBindingKey(v.characterId, v.memberId),
      v,
    ]),
  );
  for (const binding of new Set([
    ...Object.keys(picture.characterVoiceDesigns?.selections ?? {}),
    ...Object.keys(picture.characterVoiceDesigns?.selectedByCharacter ?? {}),
  ]))
    if (!bindings.has(binding))
      issues.push({
        binding,
        reason:
          "Selected speaker or iteration is missing; choose and approve an existing reference.",
      });
  for (const [binding, v] of bindings) {
    const result = resolveCharacterVoice(picture, v.characterId, v.memberId);
    if (!result.voice) {
      issues.push({ binding, reason: result.issue! });
      continue;
    }
    references.push({
      binding,
      characterId: v.characterId,
      memberId: v.memberId,
      iterationId: result.voice.id,
      approvalRevision: result.voice.revision!,
      reference: structuredClone(result.voice),
    });
  }
  return {
    schemaVersion: 1,
    kind: "identity_reference",
    pictureId: picture.id,
    exportedAt: now,
    references,
    issues,
  };
}
export function parseVoiceReferenceManifest(input: unknown): VoiceReferenceManifest {
  const m = input as VoiceReferenceManifest;
  if (
    m?.schemaVersion !== 1 ||
    m.kind !== "identity_reference" ||
    typeof m.pictureId !== "string" ||
    !Array.isArray(m.references) ||
    !Array.isArray(m.issues)
  )
    throw new Error("Invalid voice-reference manifest.");
  const seen = new Set<string>();
  for (const r of m.references) {
    if (
      !r.reference ||
      seen.has(r.binding) ||
      r.binding !== voiceBindingKey(r.characterId, r.memberId) ||
      r.iterationId !== r.reference.id ||
      r.characterId !== r.reference.characterId ||
      r.memberId !== r.reference.memberId ||
      r.approvalRevision !== r.reference.revision ||
      r.reference.status !== "APPROVED" ||
      !/^[a-f0-9]{64}$/.test(r.reference.audio?.sha256 ?? "") ||
      typeof r.reference.referenceText !== "string"
    )
      throw new Error("Invalid selected reference binding or approval.");
    seen.add(r.binding);
  }
  return structuredClone(m);
}
