import type { Picture } from "./types.ts";
import { PRODIGAL_VOICE_DESIGNS } from "./bundled-pictures/prodigal-son/voices.ts";
import { PRODIGAL_SON_SOURCE } from "./bundled-pictures/prodigal-son/source.ts";
import type { VoiceDesign, VoiceDesignAsset } from "./voice-design-library.ts";

export type CharacterVoiceSample = {
  id: string;
  mediaUri: string;
  sha256: string;
  bytes: number;
  durationSec: number;
  sampleRate: number;
  generatedAt: number;
  seed: number;
};

export type CharacterVoiceProfile = {
  id: string;
  characterId: string;
  name: string;
  memberLabel?: string;
  role: string;
  reviewNote?: string;
  designPrompt: string;
  sampleText: string;
  textKind: "screenplay" | "audition";
  sceneIds: string[];
  aliasOf?: string;
  sample: CharacterVoiceSample;
};

export type CharacterVoiceDesignManifest = {
  schemaVersion: 1;
  id: string;
  pictureId: string;
  screenplaySha256: string;
  modelId: string;
  profiles: CharacterVoiceProfile[];
};

export type CharacterVoiceReviewStatus = "NEEDS_REVIEW" | "APPROVED" | "REJECTED";
export type CharacterVoiceDesign = CharacterVoiceProfile & {
  attachmentId: string;
  manifestId: string;
  modelId: string;
  screenplaySha256: string;
  status: CharacterVoiceReviewStatus;
  reviewedAt: number | null;
};
export type CharacterVoiceIteration = {
  id: string; characterId: string; name: string; description: string; referenceText: string;
  createdAt: number; status: "DRAFT" | CharacterVoiceReviewStatus; reviewedAt: number | null;
  design?: VoiceDesign;
  audio?: { mediaUri: string; filename: string; bytes: number; origin: "imported" | "generated"; durationSec?: number; sampleRate?: number };
  source?: { pictureId: string; characterId?: string; iterationId: string };
};
export type CharacterVoiceDesignState = {
  schemaVersion: 1; profiles: CharacterVoiceDesign[];
  iterations?: CharacterVoiceIteration[];
  selectedByCharacter?: Record<string, string>;
  deletedAttachmentIds?: string[];
};

const SOURCE_SHA256 = "b44704444023df54cc940ad2a619ecda68ee6b35eec650284ef509da2c6f3b32";
const HASH = /^[a-f0-9]{64}$/;
const WAV_URI = /^\/pictures\/prodigal-son\/voice-designs\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.wav$/;

/** Files are generated separately; this function only attaches verified manifest metadata. */
export function validateCharacterVoiceManifest(manifest: CharacterVoiceDesignManifest): string[] {
  const issues: string[] = [];
  if (manifest.schemaVersion !== 1 || !manifest.id || !manifest.pictureId || !manifest.modelId || !HASH.test(manifest.screenplaySha256)) issues.push("Voice manifest metadata is incomplete.");
  const profileIds = new Set<string>();
  for (const profile of manifest.profiles) {
    if (!profile.id || profileIds.has(profile.id)) issues.push(`Duplicate or missing voice profile ID: ${profile.id}`);
    profileIds.add(profile.id);
    if (!profile.characterId || !profile.name.trim() || !profile.designPrompt.trim() || !profile.sampleText.trim()) issues.push(`Voice ${profile.id} is missing its character, design, or sample text.`);
    if (profile.textKind !== "screenplay" && profile.textKind !== "audition") issues.push(`Voice ${profile.id} must label its text as screenplay or audition.`);
    const sample = profile.sample;
    if (!sample?.id || !WAV_URI.test(sample.mediaUri) || !HASH.test(sample.sha256)
      || !Number.isSafeInteger(sample.bytes) || sample.bytes <= 44 || !Number.isFinite(sample.durationSec) || sample.durationSec <= 0
      || !Number.isInteger(sample.sampleRate) || sample.sampleRate <= 0 || !Number.isFinite(sample.generatedAt) || sample.generatedAt <= 0
      || !Number.isSafeInteger(sample.seed)) issues.push(`Voice ${profile.id} has invalid generated WAV metadata.`);
  }
  for (const profile of manifest.profiles) {
    if (!profile.aliasOf) continue;
    const source = manifest.profiles.find((item) => item.id === profile.aliasOf);
    if (!source || source.id === profile.id || source.sample.sha256 !== profile.sample.sha256 || source.sample.mediaUri !== profile.sample.mediaUri) issues.push(`Voice ${profile.id} must reuse its alias source audio.`);
  }
  return issues;
}

/** Merge by speaker and audio hash. Existing reviews, characters, and visual approvals are immutable here. */
export function hydrateProdigalCharacterVoices(picture: Picture, manifest: CharacterVoiceDesignManifest = PRODIGAL_VOICE_DESIGNS): Picture {
  if (!manifest.profiles.length || picture.id !== manifest.pictureId || manifest.screenplaySha256 !== SOURCE_SHA256 || validateCharacterVoiceManifest(manifest).length) return picture;
  const approved = picture.screenplay.versions.find((version) => version.id === picture.screenplay.approvedVersionId);
  // Exact comparison to the independently hashed source avoids asynchronous hashing during store hydration.
  if (!approved || approved.fountain !== PRODIGAL_SON_SOURCE.fountain) return picture;
  const existing = picture.characterVoiceDesigns?.schemaVersion === 1 ? picture.characterVoiceDesigns.profiles : [];
  const profiles = [...existing];
  const attachments = new Set(existing.map((profile) => profile.attachmentId));
  const deleted = new Set(picture.characterVoiceDesigns?.deletedAttachmentIds ?? []);
  const characterIds = new Set(picture.production?.assets.filter((asset) => asset.category === "character" && !asset.tombstone).map((asset) => asset.id) ?? []);
  for (const profile of manifest.profiles) {
    if (!characterIds.has(profile.characterId)) continue;
    const attachmentId = `voice-design:${profile.id}:${profile.sample.sha256}`;
    if (attachments.has(attachmentId) || deleted.has(attachmentId)) continue;
    profiles.push({ ...profile, sceneIds: [...profile.sceneIds], sample: { ...profile.sample }, attachmentId,
      manifestId: manifest.id, modelId: manifest.modelId, screenplaySha256: manifest.screenplaySha256,
      status: "NEEDS_REVIEW", reviewedAt: null });
    attachments.add(attachmentId);
  }
  return profiles.length === existing.length ? picture : { ...picture, characterVoiceDesigns: { ...picture.characterVoiceDesigns, schemaVersion: 1, profiles } };
}

export function characterVoiceDesigns(picture: Picture, characterId: string): CharacterVoiceDesign[] {
  if (!picture.production?.assets.some((asset) => asset.id === characterId && asset.category === "character" && !asset.tombstone)) return [];
  return picture.characterVoiceDesigns?.schemaVersion === 1 ? picture.characterVoiceDesigns.profiles.filter((profile) => profile.characterId === characterId) : [];
}

/** A voice audition decision is separate from a character/image approval or a production dialogue take. */
export function reviewCharacterVoiceDesign(picture: Picture, attachmentId: string, status: CharacterVoiceReviewStatus, now = Date.now()): Picture {
  const state = picture.characterVoiceDesigns!;
  const profile = allCharacterVoiceIterations(picture).find((item) => item.id === attachmentId);
  if (!profile) throw new Error("Voice sample was not found.");
  if (!["NEEDS_REVIEW", "APPROVED", "REJECTED"].includes(status)) throw new Error("Unknown voice review decision.");
  if (!profile.audio) throw new Error("Import an audio audition before approving or reviewing this design.");
  const selectedByCharacter = { ...state.selectedByCharacter };
  if (status === "APPROVED") selectedByCharacter[profile.characterId] = attachmentId;
  else if (selectedByCharacter[profile.characterId] === attachmentId) delete selectedByCharacter[profile.characterId];
  const decision = (id: string, characterId: string, currentStatus: string) => id === attachmentId
    ? { status, reviewedAt: status === "NEEDS_REVIEW" ? null : now }
    : status === "APPROVED" && characterId === profile.characterId && currentStatus === "APPROVED"
      ? { status: "NEEDS_REVIEW" as const, reviewedAt: null } : {};
  return { ...picture, updatedAt: now,
    characters: picture.characters.map((character) => character.id !== profile.characterId ? character : {
      ...character, voiceId: status === "APPROVED" ? attachmentId : character.voiceId === attachmentId ? "" : character.voiceId,
    }),
    characterVoiceDesigns: { ...state, selectedByCharacter,
      profiles: state.profiles.map((item) => ({ ...item, ...decision(item.attachmentId, item.characterId, item.status) })),
      iterations: state.iterations?.map((item) => ({ ...item, ...decision(item.id, item.characterId, item.status) })),
    },
  };
}

export function allCharacterVoiceIterations(picture: Picture): CharacterVoiceIteration[] {
  const state = picture.characterVoiceDesigns;
  const live = new Set(picture.production?.assets.filter((asset) => asset.category === "character" && !asset.tombstone).map((asset) => asset.id) ?? []);
  return [
    ...(state?.profiles ?? []).map((profile): CharacterVoiceIteration => ({
      id: profile.attachmentId, characterId: profile.characterId, name: profile.memberLabel ? `${profile.name} · ${profile.memberLabel}` : profile.name,
      description: profile.designPrompt, referenceText: profile.sampleText, createdAt: profile.sample.generatedAt,
      status: profile.status, reviewedAt: profile.reviewedAt,
      audio: { mediaUri: profile.sample.mediaUri, filename: profile.sample.mediaUri.split("/").pop()!, bytes: profile.sample.bytes,
        origin: "generated", durationSec: profile.sample.durationSec, sampleRate: profile.sample.sampleRate },
    })),
    ...(state?.iterations ?? []),
  ].filter((item) => live.has(item.characterId));
}

export function selectedCharacterVoice(picture: Picture, characterId: string): CharacterVoiceIteration | undefined {
  const approved = allCharacterVoiceIterations(picture).filter((item) => item.characterId === characterId && item.status === "APPROVED");
  return approved.find((item) => item.id === picture.characterVoiceDesigns?.selectedByCharacter?.[characterId])
    ?? approved.sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0))[0];
}

function requireCharacter(picture: Picture, characterId: string) {
  if (!picture.production?.assets.some((asset) => asset.id === characterId && asset.category === "character" && !asset.tombstone)) throw new Error("The character profile is no longer available.");
}

export function attachVoiceDesignAsset(picture: Picture, characterId: string, asset: VoiceDesignAsset, id: string): Picture {
  requireCharacter(picture, characterId);
  const state = picture.characterVoiceDesigns ?? { schemaVersion: 1 as const, profiles: [] };
  if (allCharacterVoiceIterations(picture).some((item) => item.id === id)) throw new Error("This iteration already exists.");
  const iteration: CharacterVoiceIteration = {
    id, characterId, name: asset.design.name,
    description: asset.design.enhancer ? `Image-guided casting · ${asset.design.enhancer.image}` : asset.design.description,
    referenceText: asset.design.referenceText, design: structuredClone(asset.design), createdAt: Date.now(),
    status: asset.audio ? "NEEDS_REVIEW" : "DRAFT", reviewedAt: null,
    ...(asset.audio ? { audio: structuredClone(asset.audio) } : {}),
    source: { pictureId: asset.sourcePictureId ?? picture.id, iterationId: asset.id },
  };
  return { ...picture, updatedAt: Date.now(), characterVoiceDesigns: { ...state, iterations: [...(state.iterations ?? []), iteration] } };
}

export function copyCharacterVoiceIteration(picture: Picture, characterId: string, sourcePicture: Picture, sourceId: string, id: string): Picture {
  requireCharacter(picture, characterId);
  const source = allCharacterVoiceIterations(sourcePicture).find((item) => item.id === sourceId);
  if (!source) throw new Error("The source voice iteration is no longer available.");
  if (allCharacterVoiceIterations(picture).some((item) => item.id === id)) throw new Error("This iteration already exists.");
  const state = picture.characterVoiceDesigns ?? { schemaVersion: 1 as const, profiles: [] };
  const iteration: CharacterVoiceIteration = { ...structuredClone(source), id, characterId, createdAt: Date.now(),
    status: source.audio ? "NEEDS_REVIEW" : "DRAFT", reviewedAt: null,
    source: { pictureId: sourcePicture.id, characterId: source.characterId, iterationId: source.id },
  };
  return { ...picture, updatedAt: Date.now(), characterVoiceDesigns: { ...state, iterations: [...(state.iterations ?? []), iteration] } };
}

/** Delete an attachment, never the shared audio file. Tombstones prevent bundled auditions reappearing. */
export function deleteCharacterVoiceIteration(picture: Picture, id: string): Picture {
  const iteration = allCharacterVoiceIterations(picture).find((item) => item.id === id);
  if (!iteration) throw new Error("The voice iteration is no longer available.");
  const state = picture.characterVoiceDesigns!;
  const selectedByCharacter = { ...state.selectedByCharacter };
  if (selectedByCharacter[iteration.characterId] === id) delete selectedByCharacter[iteration.characterId];
  return { ...picture, updatedAt: Date.now(),
    characters: picture.characters.map((character) => character.id === iteration.characterId && character.voiceId === id ? { ...character, voiceId: "" } : character),
    characterVoiceDesigns: { ...state, selectedByCharacter,
      profiles: state.profiles.filter((item) => item.attachmentId !== id),
      iterations: state.iterations?.filter((item) => item.id !== id),
      deletedAttachmentIds: [...new Set([...(state.deletedAttachmentIds ?? []), id])],
    },
  };
}
