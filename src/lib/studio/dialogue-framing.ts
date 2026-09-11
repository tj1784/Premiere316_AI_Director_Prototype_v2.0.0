import type { Shot } from "./types.ts";

/** The director's default applies to planning and every generated media prompt. */
export const DIALOGUE_FACE_FRAMING = "When a character speaks, use a close-up with the speaking face large in frame. Keep the eyes, mouth and facial texture sharply resolved, with enough depth of field for the performance; never leave a visible speaker as a small, smudged background face. Use another composition only for an explicit artistic purpose recorded in the shot, such as an offscreen line over a meaningful reaction. Establish geography and use wider compositions between dialogue beats.";

export function dialogueFramingDirection(shot?: Pick<Shot, "dialogueFraming" | "dialogueFramingException">): string {
  const exception = shot?.dialogueFraming === "artistic_exception" ? shot.dialogueFramingException?.trim() : "";
  return exception ? `${DIALOGUE_FACE_FRAMING} This shot's deliberate exception: ${exception}` : DIALOGUE_FACE_FRAMING;
}
