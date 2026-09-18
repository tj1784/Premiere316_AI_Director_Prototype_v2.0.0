import { BODY_REGIONS, FACE_REGIONS } from "./constants.ts";
import type { CueChannel } from "./types.ts";

export interface RequiredRegion {
  channel: CueChannel;
  region: string;
}

// Authored prose is not a machine-readable anatomy contract. Check the complete
// instruction conservatively: an uncertain modifier is retained for review,
// never split into a newly invented fragment to make it pass a framing filter.
const REGION_WORDS: [CueChannel, string, RegExp][] = [
  ["face", "brows_forehead", /\b(brows?|forehead|frown|crease)\b/i],
  ["face", "eyelids", /\b(eyelids?|lids?|squint)\b/i],
  ["face", "gaze", /\b(gaze|eyes?|look\w*|glance\w*|stare\w*|watch\w*)\b/i],
  ["face", "blink", /\b(blink\w*)\b/i],
  ["face", "cheeks", /\b(cheeks?)\b/i],
  ["face", "nose_nostrils", /\b(nose|nostrils?)\b/i],
  ["face", "lips_mouth", /\b(lips?|mouth|smil\w*|grin\w*)\b/i],
  ["face", "jaw_chin", /\b(jaw|chin)\b/i],
  ["face", "head_neck", /\b(head|neck|nod\w*)\b/i],
  ["face", "complexion", /\b(complexion|flush\w*|pallor|tears?|moist\w*)\b/i],
  ["body", "head_neck", /\b(head|neck|nod\w*)\b/i],
  ["body", "shoulders", /\b(shoulders?|shrug\w*)\b/i],
  ["body", "chest_torso", /\b(chest|torso|lean\w*)\b/i],
  ["body", "arms_elbows", /\b(arms?|elbows?|forearms?|reach\w*|wave\w*|gestur\w*)\b/i],
  ["body", "hands_fingers", /\b(hands?|fingers?|palms?|grip\w*|wave\w*|handl\w*)\b/i],
  ["body", "pelvis_weight", /\b(pelvis|hips?|weight|stance|stand\w*|sit\w*|seated|balance)\b/i],
  ["body", "legs_feet", /\b(feet|foot|legs?|knees?)\b/i],
  ["body", "gait", /\b(walk\w*|step\w*|stride\w*|gait|pac(?:e|ing)|run\w*)\b/i],
  ["body", "proxemics", /\b(distance|approach\w*|retreat\w*|closer)\b/i],
  [
    "body",
    "touch_props",
    /\b(touch\w*|props?|objects?|tool\w*|embrace\w*|hold\w* evidence|place\w* evidence)\b/i,
  ],
  ["body", "stillness", /\b(stillness|motionless|immobile|body quiet)\b/i],
  ["voice", "pitch_register", /\b(pitch|register)\b/i],
  ["voice", "pitch_range_contour", /\b(contour|cadence|intonation|inflection)\b/i],
  ["voice", "loudness", /\b(volume|loud\w*|audib\w*|projection|shout\w*|whisper\w*)\b/i],
  ["voice", "tempo_rhythm", /\b(tempo|rhythm|pace|speed|slow\w*|fast\w*|fragments?|bursts?)\b/i],
  ["voice", "stress", /\b(stress|emphasis|emphasi[sz]\w*)\b/i],
  ["voice", "articulation", /\b(articulat\w*|diction|syntax|consonants?|intelligib\w*)\b/i],
  ["voice", "resonance", /\b(resonance|resonant)\b/i],
  ["voice", "texture", /\b(texture|timbre|tone|rasp\w*|rough\w*|breathy|creak\w*)\b/i],
  ["voice", "breath_phrasing", /\b(breath\w*|inhale\w*|exhale\w*|phrasing)\b/i],
  ["voice", "pauses", /\b(paus\w*|gap\w*|silence|silent)\b/i],
];

export function requiredRegions(
  text: string,
  channel?: CueChannel,
  primary?: string,
): RequiredRegion[] {
  const result: RequiredRegion[] = primary && channel ? [{ channel, region: primary }] : [];
  for (const [kind, region, pattern] of REGION_WORDS) {
    // "Pace" in a delivery instruction is not a request to walk. Head/neck
    // belongs to either face or body, depending on the selected channel.
    if (
      channel === "voice" &&
      kind === "body" &&
      region === "gait" &&
      !/\b(walk\w*|step\w*|stride\w*|gait|running|run|pac(?:e|ing) (?:around|across|back|up|down))\b/i.test(
        text,
      )
    )
      continue;
    if (channel === "voice" && kind === "body") {
      // Delivery prose uses weight, distance, a comic wave and "let a phrase
      // stand" metaphorically. Require a physical referent for those terms.
      if (
        region === "pelvis_weight" &&
        !/\b(pelvis|hips?|stance|seated|stand up|sit down|(?:shift|settle)\w* (?:the |your )?weight)\b/i.test(
          text,
        )
      )
        continue;
      if (
        region === "proxemics" &&
        !/\b(physical distance|approach\w*|retreat\w*|move\w* closer)\b/i.test(text)
      )
        continue;
      if (
        (region === "arms_elbows" || region === "hands_fingers") &&
        !/\b(arms?|elbows?|forearms?|hands?|fingers?|palms?|grip\w*|reach\w*|gestur\w*)\b/i.test(
          text,
        )
      )
        continue;
    }
    if (region === "head_neck" && kind !== (channel === "body" ? "body" : "face")) continue;
    if (pattern.test(text)) result.push({ channel: kind, region });
  }
  if (/\b(face|facial expression)\b/i.test(text)) {
    result.push(...FACE_REGIONS.map((region) => ({ channel: "face" as const, region })));
  }
  if (/\b(whole body|full.body)\b/i.test(text)) {
    result.push(...BODY_REGIONS.map((region) => ({ channel: "body" as const, region })));
  }
  return result.filter(
    (entry, i) =>
      result.findIndex(
        (other) => other.channel === entry.channel && other.region === entry.region,
      ) === i,
  );
}

export function speechConflict(text: string, hasSpeech: boolean): string | null {
  if (
    /\bor\b/i.test(text) &&
    !/\b(?:without|avoid\w*|no|not|rather than|instead of|more than|more important than|name or role|need or boundary)\b/i.test(
      text,
    )
  ) {
    return "contains unresolved alternative instructions; choose one or author separate beats";
  }
  if (
    /\b(?:replace|instead of|rather than)\b[^.!?]{0,75}\b(?:sentences?|words?|speech|dialogue)\b/i.test(
      text,
    ) ||
    /\b(?:reduce|shorten|cut|simplify)\s+(?:the\s+)?(?:speech|sentence|dialogue|words)\b/i.test(
      text,
    ) ||
    /\b(?:add|repeat|say|speak|name|ask|answer|give)\b[^.!?]{0,45}\b(?:name|question|answer|acknowledgment|greeting|apology|command)\b/i.test(
      text,
    ) ||
    /\b(?:lips? form a name|sentence fails to emerge|unfinished attempt at speech)\b/i.test(text)
  ) {
    return "requires changed, additional, or omitted speech";
  }
  if (
    hasSpeech &&
    /\b(?:remain|stay|keep|be|in)\s+(?:completely\s+|entirely\s+)?silent\b|\b(?:sealed mouth|seal the (?:lips|mouth)|close[ds]? (?:the )?mouth|without (?:words|speaking|sound))\b/i.test(
      text,
    )
  ) {
    return "conflicts with the authorized spoken line";
  }
  // Sound permission permits only separately authored, timed events. It does
  // not authorize an automatic laugh/gasp suggested by a preset.
  if (
    /\b(?:laugh(?:s|ing)?|laughter|sob\w*|gasp\w*|cr(?:y|ies|ying)|sigh\w*)\b(?![- ](?:colored|edged|like))/i.test(
      text,
    ) &&
    !/\b(?:no|without|do not|need not|avoid\w*|instead of)\b[^.!?]{0,50}\b(?:laugh|sob|gasp|cry|sigh)/i.test(
      text,
    )
  ) {
    return "requires a separately authored and timed nonverbal sound event";
  }
  return null;
}
