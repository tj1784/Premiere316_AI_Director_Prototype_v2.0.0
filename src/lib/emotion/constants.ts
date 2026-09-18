import type {
  BodyRegion,
  CueBudget,
  CueChannel,
  FaceRegion,
  Framing,
  PerformanceSettings,
  Regulation,
  ResolvedSettings,
  VoiceRegion,
} from "./types.ts";

export { INTENSITY_LABELS } from "./types.ts";

export const FACE_REGIONS: FaceRegion[] = [
  "brows_forehead",
  "eyelids",
  "gaze",
  "blink",
  "cheeks",
  "nose_nostrils",
  "lips_mouth",
  "jaw_chin",
  "head_neck",
  "complexion",
];

export const VOICE_REGIONS: VoiceRegion[] = [
  "pitch_register",
  "pitch_range_contour",
  "loudness",
  "tempo_rhythm",
  "stress",
  "articulation",
  "resonance",
  "texture",
  "breath_phrasing",
  "pauses",
  "nonverbal_vocalizations",
];

export const BODY_REGIONS: BodyRegion[] = [
  "head_neck",
  "shoulders",
  "chest_torso",
  "arms_elbows",
  "hands_fingers",
  "pelvis_weight",
  "legs_feet",
  "gait",
  "proxemics",
  "touch_props",
  "stillness",
];

export const CHANNEL_REGIONS: Record<CueChannel, readonly string[]> = {
  face: FACE_REGIONS,
  voice: VOICE_REGIONS,
  body: BODY_REGIONS,
};

export const FRAMING_BUDGETS: Record<Framing, CueBudget> = {
  extreme_close_up: { face: 2, voice: 2, body: 0 },
  close_up: { face: 2, voice: 2, body: 1 },
  medium: { face: 2, voice: 2, body: 2 },
  wide: { face: 1, voice: 2, body: 2 },
  audio_only: { face: 0, voice: 3, body: 0 },
  silent_reaction: { face: 2, voice: 0, body: 2 },
};

export const FRAMING_LABELS: Record<Framing, string> = {
  extreme_close_up: "Extreme close-up",
  close_up: "Close-up",
  medium: "Medium / waist-up",
  wide: "Wide",
  audio_only: "Audio only",
  silent_reaction: "Silent reaction",
};

export const REGULATION_LABELS: Record<Regulation, string> = {
  open: "Open",
  restrained: "Restrained",
  suppressed: "Suppressed",
  masked: "Masked",
  performed: "Performed",
  conflicted: "Conflicted",
};

export const REGULATION_HELP: Record<Regulation, string> = {
  open: "Play the felt state as written.",
  restrained: "Contain the display; use the restrained alternative.",
  suppressed: "Keep the feeling private; outward behavior stays economical.",
  masked: "Felt state stays hidden; show a separately chosen display.",
  performed: "The character is acting a display they may not feel.",
  conflicted: "Assign competing impulses to different channels or beats.",
};

export const STATE_TYPE_LABELS: Record<string, string> = {
  emotion: "Emotion",
  affective_state: "Affective state",
  motivational_state: "Motivational state",
  interpersonal_attitude: "Interpersonal attitude",
  reaction_complex: "Reaction complex",
  cognitive_affective_process: "Cognitive-affective process",
  culturally_lexicalized: "Culturally lexicalized",
  neutral_baseline: "Neutral baseline",
};

export const INTENSITY_HELP = [
  "The appraisal begins to alter attention; a brief cue may be enough.",
  "The feeling is present and recurring while ordinary tasks remain easy.",
  "The emotion organizes a recognizable choice, rhythm or relationship response.",
  "The feeling noticeably competes with normal attention and performance.",
  "The emotion strongly shapes priorities and requires effort to contain or channel.",
  "It dominates the current task; other concerns narrow or are temporarily displaced.",
  "It defines the moment’s subjective experience or the state’s maximal salience.",
] as const;

export const CLOSE_FACE_REGIONS = new Set(FACE_REGIONS);
export const WIDE_FACE_REGIONS = new Set<string>([
  "brows_forehead",
  "gaze",
  "lips_mouth",
  "head_neck",
  "cheeks",
  "jaw_chin",
]);
export const CLOSE_BODY_REGIONS = new Set<string>(["head_neck", "shoulders", "stillness"]);
export const MEDIUM_BODY_REGIONS = new Set<string>([
  "head_neck",
  "shoulders",
  "chest_torso",
  "arms_elbows",
  "hands_fingers",
  "stillness",
  "touch_props",
]);

const LOWER_BODY_RE = /\b(feet|foot|walk(?:ing)?|step(?:s|ping)?|stride|gait|pace|legs?)\b/i;

export function visibleRegions(framing: Framing, channel: CueChannel): Set<string> | null {
  if (channel === "voice") {
    return framing === "silent_reaction" ? new Set() : null;
  }
  if (channel === "face") {
    if (framing === "audio_only") return new Set();
    if (framing === "wide") return WIDE_FACE_REGIONS;
    return CLOSE_FACE_REGIONS;
  }
  if (framing === "extreme_close_up" || framing === "audio_only") return new Set();
  if (framing === "close_up") return CLOSE_BODY_REGIONS;
  if (framing === "medium" || framing === "silent_reaction") return MEDIUM_BODY_REGIONS;
  return null;
}

export function cueMentionsUnseenBody(text: string, framing: Framing): boolean {
  if (framing === "wide") return false;
  if (framing === "audio_only") return true;
  return LOWER_BODY_RE.test(text);
}

export const RUNTIME_DEFAULTS: Omit<ResolvedSettings, "cue_budget"> = {
  felt_layers: [],
  displayed_selection: null,
  regulation: "open",
  display_allowance: 0.6,
  arousal_override: null,
  objective: "",
  appraisal: "",
  relationship_context: "",
  physical_context: "",
  framing: "close_up",
  cue_selection_mode: "stable",
  cue_selection_seed: null,
  allow_narration: false,
  allow_extra_dialogue: false,
  allow_nonverbal_vocalizations: false,
  allowed_sound_events: [],
  continuity: { from_line_id: null, restart_onset: false },
};

export const DEFAULT_ADAPTER = {
  id: "project_adapter",
  version: "unconfigured",
  capabilities: {
    visual_direction: "unverified",
    delivery_instruction: "unverified",
    separate_speech: "unverified",
    timed_beats: "unverified",
    numeric_pitch_rate_gain: "unverified",
    facial_regions: "unverified",
    voice_reference: "unverified",
    nonverbal_vocals: "unverified",
  },
  unsupported_policy: "warn_export_text",
};

export const SETTINGS_TRACE_KEYS: (keyof PerformanceSettings)[] = [
  "felt_layers",
  "displayed_selection",
  "regulation",
  "display_allowance",
  "arousal_override",
  "objective",
  "appraisal",
  "relationship_context",
  "physical_context",
  "framing",
  "cue_budget",
  "cue_selection_mode",
  "cue_selection_seed",
  "region_filters",
  "face_overrides",
  "voice_overrides",
  "body_overrides",
  "allow_narration",
  "allow_extra_dialogue",
  "allow_nonverbal_vocalizations",
  "allowed_sound_events",
  "continuity",
  "explicit_cue_ids",
];

export const REGION_LABELS: Record<string, string> = {
  brows_forehead: "Brows / forehead",
  eyelids: "Eyelids",
  gaze: "Gaze",
  blink: "Blink",
  cheeks: "Cheeks",
  nose_nostrils: "Nose",
  lips_mouth: "Lips / mouth",
  jaw_chin: "Jaw / chin",
  head_neck: "Head / neck",
  complexion: "Complexion",
  pitch_register: "Pitch register",
  pitch_range_contour: "Pitch contour",
  loudness: "Loudness",
  tempo_rhythm: "Tempo / rhythm",
  stress: "Stress",
  articulation: "Articulation",
  resonance: "Resonance",
  texture: "Texture",
  breath_phrasing: "Breath / phrasing",
  pauses: "Pauses",
  nonverbal_vocalizations: "Nonverbal vocals",
  shoulders: "Shoulders",
  chest_torso: "Chest / torso",
  arms_elbows: "Arms / elbows",
  hands_fingers: "Hands",
  pelvis_weight: "Pelvis / weight",
  legs_feet: "Legs / feet",
  gait: "Gait",
  proxemics: "Distance",
  touch_props: "Touch / props",
  stillness: "Stillness",
};
