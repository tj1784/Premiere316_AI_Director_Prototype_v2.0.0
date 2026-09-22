import type { Picture } from "./types.ts";
import { BIBLE_FIELDS, editBibleField, type BibleField, type BibleKind } from "./movie-bible.ts";

/** Presentation groups refer to the canonical Bible keys. They never allocate another identity. */
export const CHARACTER_SECTIONS = [
  {
    id: "identity",
    title: "Identity",
    subtitle: "Who they are. What remains constant.",
    fields: [0, 1, 2, 3],
  },
  {
    id: "inner-life",
    title: "Inner life",
    subtitle: "Objectives, contradictions and relationships.",
    fields: [4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: "performance",
    title: "Performance",
    subtitle: "Playable behavior, control and recovery.",
    fields: [11, 12, 15],
  },
  {
    id: "voice-rules",
    title: "Voice & rules",
    subtitle: "Voice identity, permissions and source boundaries.",
    fields: [13, 14, 16],
  },
] as const;

export const CHARACTER_FIELD_DETAILS: Record<string, { label: string; hint: string }> = {
  [BIBLE_FIELDS.character[0]]: {
    label: "Identity & story role",
    hint: "Name, aliases, story role and established age. Distinguish the character from a performer or reference; identify ensemble membership where applicable.",
  },
  [BIBLE_FIELDS.character[1]]: {
    label: "Appearance & visual identity",
    hint: "Face, hair, beard, body, proportions, hands and distinguishing features. Link the front, three-quarter, profile and full-body references that establish identity.",
  },
  [BIBLE_FIELDS.character[2]]: {
    label: "Wardrobe, props & habits",
    hint: "Baseline costume, carried objects and habitual use. Link wardrobe, prop and appearance records; keep temporary dirt, damage and costume changes in scene state.",
  },
  [BIBLE_FIELDS.character[3]]: {
    label: "History, wound & source boundaries",
    hint: "Authored history, relevant events and any established wound. For a role without relevant biography, mark not applicable and explain why; do not invent one.",
  },
  [BIBLE_FIELDS.character[4]]: {
    label: "Beliefs & defensive lie",
    hint: "What they believe, including a defensive belief or lie where the source supports it. Distinguish sourced fact from acting direction.",
  },
  [BIBLE_FIELDS.character[5]]: {
    label: "Super-objective & want",
    hint: "The film-long objective and conscious external goal. Label each separately when they differ.",
  },
  [BIBLE_FIELDS.character[6]]: {
    label: "Need & inner change",
    hint: "The inner change tested by the story, or a role-specific reason that no transformation is required.",
  },
  [BIBLE_FIELDS.character[7]]: {
    label: "Mask",
    hint: "Their public behavior: what they deliberately reveal, protect or conceal.",
  },
  [BIBLE_FIELDS.character[8]]: {
    label: "Tells under pressure",
    hint: "Specific changes in face, attention, breath, voice, hands, posture or pace. Use compatible behavior grounded in this character.",
  },
  [BIBLE_FIELDS.character[9]]: {
    label: "Knowledge boundaries",
    hint: "What they know, suspect or misunderstand; what they must not anticipate. Scene-specific changes belong in incoming and outgoing state.",
  },
  [BIBLE_FIELDS.character[10]]: {
    label: "Relationships & foils",
    hint: "Name the related character or record: bonds, status, trust, conflict, and the particular pressure each partner creates.",
  },
  [BIBLE_FIELDS.character[11]]: {
    label: "Movement & mobility",
    hint: "Baseline posture, gait, gesture habits, established handedness and limitations. Temporary exhaustion or injury belongs to scene state.",
  },
  [BIBLE_FIELDS.character[12]]: {
    label: "Regulation, release & recovery",
    hint: "Containment, permitted expression, triggers for release and what remains afterward. Felt intensity, displayed affect and vocal loudness are separate.",
  },
  [BIBLE_FIELDS.character[13]]: {
    label: "Voice, language & accent",
    hint: "Voice identity and usable reference binding; language, accent, register, grain, habitual rhythm and authored pronunciation. Audition actual media in References & voice.",
  },
  [BIBLE_FIELDS.character[14]]: {
    label: "Authorized speech & sounds",
    hint: "Exact authorized line references and separately authored vocal events. Silence is intentional; it does not authorize invented speech or sounds.",
  },
  [BIBLE_FIELDS.character[15]]: {
    label: "Performance references",
    hint: "Approved acting benchmarks, reference IDs and the specific qualities to follow. An acting reference does not authorize borrowing likeness, voice or dialogue.",
  },
  [BIBLE_FIELDS.character[16]]: {
    label: "Prohibited inventions",
    hint: "Limits on invented history, words, behavior and identity, including features or period details that must never appear.",
  },
};

export type CharacterFieldView = {
  value: string;
  source: string;
  disposition: BibleField["disposition"] | "source";
  revision: number;
};
export function characterFieldView(
  picture: Picture,
  characterId: string,
  field: string,
): CharacterFieldView {
  const authored = picture.movieBible?.records[characterId]?.fields[field];
  // An explicit missing disposition is meaningful and must not be replaced by an older source.
  if (authored) return { ...authored };
  const asset = picture.production?.assets.find((a) => a.id === characterId && !a.tombstone);
  const character = picture.characters.find((c) => c.id === characterId);
  const spec = asset?.canonicalSpec;
  const parts: string[] = [];
  const add = (label: string, value?: string) => {
    if (value?.trim()) parts.push(`${label}: ${value}`);
  };
  if (field === BIBLE_FIELDS.character[0]) {
    add("Identity", spec?.identity ?? character?.name);
    if (character?.role !== (spec?.identity ?? character?.name)) add("Role", character?.role);
    add("Established age", spec?.age || character?.age);
    if (asset?.aliases.length) add("Aliases", asset.aliases.join(", "));
  } else if (field === BIBLE_FIELDS.character[1]) {
    add("Visual description", spec?.visualDescription || character?.look);
    for (const [label, value] of [
      ["Appearance", spec?.appearance],
      ["Face", spec?.facialGeometry],
      ["Build", spec?.build],
      ["Hair", spec?.hair],
      ["Skin", spec?.skin],
    ] as const)
      add(label, value);
    add("Distinguishing features", spec?.distinguishingFeatures.join("; "));
  } else if (field === BIBLE_FIELDS.character[2]) add("Baseline wardrobe", spec?.wardrobe);
  else if (field === BIBLE_FIELDS.character[16]) {
    add("Prohibited features", spec?.prohibitedFeatures.join("\n"));
    add("Negative requirements", spec?.negativeRequirements.join("\n"));
  }
  return {
    value: parts.join("\n\n"),
    source: parts.length
      ? `${asset ? "Canonical asset" : "Character record"} · ${characterId}`
      : "",
    disposition: parts.length ? "source" : "missing",
    revision: 0,
  };
}

export type BibleFieldEdit = {
  recordId: string;
  kind: BibleKind;
  field: string;
  value: string;
  source: string;
  disposition: BibleField["disposition"];
  baseRevision: number;
};
/** Compare at field scope: other edits and workspace drafts must not be overwritten. */
export function applyCharacterFieldEdit(picture: Picture, edit: BibleFieldEdit): Picture {
  const actual = picture.movieBible?.records[edit.recordId]?.fields[edit.field];
  if ((actual?.revision ?? 0) !== edit.baseRevision)
    throw new Error(
      "This field changed while you were editing. Your draft is retained. Use Reset to saved value to review the current value before saving.",
    );
  if (edit.value.trim() && !edit.source.trim())
    throw new Error("Add a source reference or identify this as authored direction.");
  return {
    ...picture,
    movieBible: editBibleField(
      picture,
      edit.recordId,
      edit.kind,
      edit.field,
      edit.value,
      edit.source,
      edit.disposition,
    ),
  };
}
