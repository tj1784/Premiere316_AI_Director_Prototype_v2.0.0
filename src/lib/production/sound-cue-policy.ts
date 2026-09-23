import type { SoundCueRecord } from "./audio-types.ts";
import type { Picture } from "../studio/types.ts";
import { parseScreenplayHierarchy, sceneNodes } from "../studio/screenplay-hierarchy.ts";

const vocalWords = /\b(?:voice|vocal|sing(?:ing|er)?|choir|chant(?:ing)?|hum(?:ming)?|lyric(?:s)?|sob(?:bing)?|gasp(?:ing)?|sigh(?:ing)?|laugh(?:ing)?|cry(?:ing)?|groan(?:ing)?)\b/i;
const dialogueWords = /\b(?:dialogue|spoken|speech|speaks?|says?|line(?:s)?|words?)\b/i;
const denied = /\b(?:no|never|without|forbid(?:den)?|prohibit(?:ed)?|not permitted|not allowed)\b/i;

function positiveVocalStatement(value: string, dialogue: boolean): boolean {
  const explicitBan = dialogue
    ? /\b(?:no|without|forbid(?:den)?|prohibit(?:ed)?)\s+(?:any\s+)?(?:dialogue|speech|spoken\s+(?:line|word)s?)\b/i
    : /\b(?:no|without|forbid(?:den)?|prohibit(?:ed)?)\s+(?:any\s+)?(?:vocal(?:s)?|voice(?:s)?|choir|singing|chanting)\b/i;
  if (explicitBan.test(value)) return false;
  return value.split(/[,;\n.]+/).some((clause) =>
    (dialogue ? dialogueWords : vocalWords).test(clause) && !denied.test(clause),
  );
}

/** A restriction such as "no vocals" is a policy, not an authored vocal event. */
export function hasVocalIntent(cue: SoundCueRecord): boolean {
  return cue.kind === "dialogue" || positiveVocalStatement(cue.vocalPolicy ?? "", false);
}

/** Only new or newly scoped vocal intent needs a fresh evidence gate. */
export function soundCueSaveError(
  picture: Picture,
  cue: SoundCueRecord,
  existing: SoundCueRecord | null = null,
): string | null {
  const scene = picture.scenes.find((item) => item.id === cue.sceneId);
  const shot = picture.shots.find((item) => item.id === cue.shotId);
  if (cue.sceneId && !scene) return "Choose an existing source scene.";
  if (cue.shotId && (!shot || !scene || shot.sceneId !== scene.id))
    return "Choose a source shot in the selected scene.";

  if (!hasVocalIntent(cue)) return null;
  if (
    existing && hasVocalIntent(existing) && existing.kind === cue.kind &&
    existing.vocalPolicy === cue.vocalPolicy && existing.sceneId === cue.sceneId &&
    existing.shotId === cue.shotId
  ) return null;

  if (!scene || !shot) return "New dialogue and vocal cues need an existing source scene and shot.";

  const approved = picture.screenplay.versions.find(
    (item) => item.id === picture.screenplay.approvedVersionId,
  );
  if (!approved?.fountain.trim())
    return "Approve the source screenplay before adding dialogue or vocal cues.";
  const hierarchy = approved.hierarchy ?? parseScreenplayHierarchy(approved.fountain);
  const sourceScene = sceneNodes(hierarchy).find(
    (item) => item.id === scene.id ||
      (item.slugline ?? item.title).trim().toLowerCase() === scene.slugline.trim().toLowerCase(),
  );
  if (!sourceScene?.fountain.trim())
    return "The selected scene must appear in the approved screenplay.";
  // Match the actual scene body: the general hierarchy parser can consume the
  // scene heading and first speaker together when dialogue opens a scene.
  const sceneBody = sourceScene.fountain.replace(/^[^\r\n]*(?:\r\n|\n|\r)/, "").trimStart();
  if (
    cue.kind === "dialogue" &&
    !/(?:^|(?:\r\n|\n|\r){2,})[A-Z][A-Z0-9 .'\-]{1,36}(?:\r\n|\n|\r)[^\r\n]*\S[^\r\n]*/.test(sceneBody)
  ) return "The approved source scene needs an authored dialogue line.";

  const permissionFields: Array<[string, string]> = [
    [shot.id, "Permitted audio"],
    [scene.id, "Sound development / intentional silence"],
  ];
  if (cue.kind === "score") permissionFields.push([scene.id, "Musical development"]);
  const permitted = permissionFields.some(([recordId, name]) => {
    const field = picture.movieBible?.records[recordId]?.fields[name];
    return field?.disposition === "authored" && Boolean(field.source?.trim()) &&
      positiveVocalStatement(field.value, cue.kind === "dialogue");
  });
  if (!permitted)
    return "Author explicit dialogue or vocal permission with its source in the selected shot or scene Bible sound field.";
  return null;
}
