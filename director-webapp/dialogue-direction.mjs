export const GLOBAL_DIALOGUE_CONTRACT_HEADER = "AUDIO / DIALOGUE CONTRACT";

export const GLOBAL_DIALOGUE_CONTRACT = [
  GLOBAL_DIALOGUE_CONTRACT_HEADER,
  "Only words inside quotation marks in the selected segment's SEGMENT DIALOGUE DIRECTION may be spoken; quotation marks anywhere else never authorize speech.",
  "Speak those quoted words exactly once, by the named speaker, with natural timing. Treat every unquoted beat, camera, continuity, transition, and prompt instruction as silent direction; never vocalize it.",
  "This selected-segment contract overrides any generic silent-picture or ambient-only wording elsewhere in the prompt.",
  "Never speak dialogue assigned to another segment. If the selected segment has no dialogue direction, generate no intelligible speech or lip-synced talking and retain only natural nonverbal ambience."
].join("\n");

export function isH03OrLaterClipId(value) {
  const match = String(value || "").toUpperCase().match(/^H(\d{2})-/);
  return Boolean(match && Number(match[1]) >= 3);
}

export function stripLegacyGlobalDialogue(value) {
  return String(value || "")
    .replace(/^[ \t]*Silent picture pass\.[^\r\n]*(?:\r?\n|$)/gim, "")
    .replace(/^[ \t]*Dialogue\/sound anchor:[^\r\n]*(?:\r?\n|$)/gim, "")
    .replace(/Performance timing reference:\s*[\s\S]*?Actors may use natural speech-shaped facial and body movement when dialogue is indicated,\s*but this is a silent picture pass:\s*generate no intelligible audio, music, sound effects, subtitles, captions or written words\.\s*/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\r?\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function withGlobalDialogueContract(value) {
  const prompt = stripLegacyGlobalDialogue(value);
  if (prompt.includes(GLOBAL_DIALOGUE_CONTRACT_HEADER)) return prompt;
  return [prompt, GLOBAL_DIALOGUE_CONTRACT].filter(Boolean).join("\n\n");
}

export function parseDialogueTurns(value) {
  const anchor = String(value || "").replace(/\s+/g, " ").trim();
  if (!anchor || /^No(?: new)? dialogue\b/i.test(anchor)) return [];

  const markers = [...anchor.matchAll(/(?:^|\s)([A-Z][A-Za-z]*(?:[ -][A-Za-z][A-Za-z'-]*){0,3}):\s*/g)];
  return markers.map((marker, index) => {
    const start = Number(marker.index) + marker[0].length;
    const end = markers[index + 1]?.index ?? anchor.length;
    return {
      speaker: marker[1].trim(),
      words: anchor.slice(start, end).trim()
    };
  }).filter((turn) => turn.words);
}

function dialogueSubject(value) {
  let speaker = String(value || "").trim();
  const offScreen = /\boff[- ]screen\b/i.test(speaker);
  speaker = speaker.replace(/\boff[- ]screen\b/ig, "").replace(/\s+/g, " ").trim();
  if (/^torturer$/i.test(speaker)) {
    speaker = "the Torturer";
  } else if (/^(?:imprisoned voices|waiting souls|souls|tormented soul|tormented king)$/i.test(speaker)) {
    speaker = `the ${speaker.toLowerCase()}`;
  }
  speaker = speaker.replace(/^the\s/i, "the ");
  if (!speaker) speaker = "The named speaker";
  if (speaker.startsWith("the ")) speaker = `The ${speaker.slice(4)}`;
  return offScreen ? `${speaker}, off-screen,` : speaker;
}

export function dialogueTurnDirection(turn, turnIndex = 0) {
  let words = String(turn?.words || "").trim().replace(/"/g, "'");
  if (!words) return "";
  if (!/[.!?\u2026]$/.test(words)) words += ".";
  const lead = turnIndex > 0 ? "Then " : "";
  const verb = turnIndex > 0 ? "replied" : "said";
  let subject = dialogueSubject(turn?.speaker);
  if (turnIndex > 0) subject = subject.replace(/^The\s/, "the ");
  return `${lead}${subject} ${verb}, "${words}"`;
}

export function dialogueDirectionsForSegments(dialogueAnchor, segmentIds) {
  const ids = Array.isArray(segmentIds) ? segmentIds.map(String) : [];
  const turns = parseDialogueTurns(dialogueAnchor);
  const directions = new Map();
  if (!ids.length || !turns.length) return directions;

  const positions = turns.length === 1
    ? [Math.min(1, ids.length - 1)]
    : turns.length === 2
      ? (ids.length >= 3 ? [1, 2] : [0, ids.length - 1])
      : turns.map((_turn, index) => Math.min(ids.length - 1, Math.floor(index * ids.length / turns.length)));

  for (let index = 0; index < turns.length; index += 1) {
    const segmentId = ids[positions[index]];
    const direction = dialogueTurnDirection(turns[index], index);
    if (!segmentId || !direction) continue;
    directions.set(segmentId, [directions.get(segmentId), direction].filter(Boolean).join(" "));
  }
  return directions;
}
