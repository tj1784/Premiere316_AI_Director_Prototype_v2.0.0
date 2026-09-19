export const INTENSITY_LABELS = [
  "Trace",
  "Mild",
  "Clear",
  "Strong",
  "Intense",
  "Consuming",
  "Overwhelming",
] as const;

export type Intensity = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type IntensityLabel = (typeof INTENSITY_LABELS)[number];

export type StateType =
  | "emotion"
  | "affective_state"
  | "motivational_state"
  | "interpersonal_attitude"
  | "reaction_complex"
  | "cognitive_affective_process"
  | "culturally_lexicalized"
  | "neutral_baseline";

export type Regulation =
  "open" | "restrained" | "suppressed" | "masked" | "performed" | "conflicted";

export type Framing =
  "extreme_close_up" | "close_up" | "medium" | "wide" | "audio_only" | "silent_reaction";

export type CueChannel = "face" | "voice" | "body";

export type FaceRegion =
  | "brows_forehead"
  | "eyelids"
  | "gaze"
  | "blink"
  | "cheeks"
  | "nose_nostrils"
  | "lips_mouth"
  | "jaw_chin"
  | "head_neck"
  | "complexion";

export type VoiceRegion =
  | "pitch_register"
  | "pitch_range_contour"
  | "loudness"
  | "tempo_rhythm"
  | "stress"
  | "articulation"
  | "resonance"
  | "texture"
  | "breath_phrasing"
  | "pauses"
  | "nonverbal_vocalizations";

export type BodyRegion =
  | "head_neck"
  | "shoulders"
  | "chest_torso"
  | "arms_elbows"
  | "hands_fingers"
  | "pelvis_weight"
  | "legs_feet"
  | "gait"
  | "proxemics"
  | "touch_props"
  | "stillness";

export type Region = FaceRegion | VoiceRegion | BodyRegion;

export type RegionalMode = "inherit" | "omit" | "replace";

export interface RegionalControl {
  mode: RegionalMode;
  instruction?: string | null;
}

export interface CueChoice {
  region: string;
  text: string;
}

export interface IntensityLevel {
  level: Intensity;
  label: IntensityLabel;
  felt_state: string;
  face: string;
  voice: string;
  body: string;
  timing: string;
  restrained_alternative: string;
  recovery: string;
  playable_direction: string;
  cue_choices: Record<CueChannel, CueChoice[]>;
}

export interface EmotionVariant {
  id: string;
  label: string;
  context: string;
  objective: string;
  face_modifier: string;
  voice_modifier: string;
  body_modifier: string;
  timing_modifier: string;
  seven_levels: { level: Intensity; modifier: string }[];
}

export interface EmotionRecord {
  id: string;
  label: string;
  family_id: string;
  family_label: string;
  subfamily_id: string;
  subfamily_label: string;
  state_type: StateType;
  aliases: string[];
  definition: string;
  appraisal: string;
  objective: string;
  action_tendencies: string[];
  distinctions: string[];
  baseline: {
    face: Record<string, string>;
    voice: Record<string, string>;
    body: Record<string, string>;
  };
  levels: IntensityLevel[];
  variants: EmotionVariant[];
  temporal_arc: {
    onset: string;
    escalation: string;
    apex: string;
    recovery: string;
    carryover: string;
  };
  transitions: { to_emotion_id: string; trigger: string; bridge: string }[];
  prompt_example: {
    spoken_text: string;
    visual_direction: string;
    delivery_direction: string;
  };
  cue_conflicts: string[];
  context_notes: string;
  coverage_status: string;
}

export interface Catalog {
  schema_version: string;
  catalog_version: string;
  title: string;
  editorial_notice: string;
  intensity_labels: string[];
  hierarchy_depths: string[];
  emotions: EmotionRecord[];
}

export interface Selection {
  emotion_id: string;
  variant_id: string;
  intensity: Intensity;
}

export interface FeltLayer {
  role: "dominant" | "secondary";
  selection: Selection;
  layer_weight: number;
}

export interface CueBudget {
  face: number;
  voice: number;
  body: number;
}

export interface Continuity {
  from_line_id: string | null;
  restart_onset: boolean;
}

export type RegionOverrides = Record<string, RegionalControl>;

export interface PerformanceSettings {
  felt_layers?: FeltLayer[];
  displayed_selection?: Selection | null;
  regulation?: Regulation;
  display_allowance?: number;
  arousal_override?: number | null;
  objective?: string;
  appraisal?: string;
  relationship_context?: string;
  physical_context?: string;
  framing?: Framing;
  cue_selection_mode?: "stable" | "seeded";
  cue_selection_seed?: number | null;
  cue_budget?: CueBudget;
  region_filters?: Partial<Record<CueChannel, string[]>>;
  face_overrides?: RegionOverrides;
  voice_overrides?: RegionOverrides;
  body_overrides?: RegionOverrides;
  allow_narration?: boolean;
  allow_extra_dialogue?: boolean;
  allow_nonverbal_vocalizations?: boolean;
  allowed_sound_events?: string[];
  continuity?: Continuity;
  explicit_cue_ids?: string[];
}

export interface ResolvedSettings {
  felt_layers: FeltLayer[];
  displayed_selection: Selection | null;
  regulation: Regulation;
  display_allowance: number;
  arousal_override: number | null;
  objective: string;
  appraisal: string;
  relationship_context: string;
  physical_context: string;
  framing: Framing;
  cue_selection_mode: "stable" | "seeded";
  cue_selection_seed: number | null;
  cue_budget: CueBudget;
  region_filters?: Partial<Record<CueChannel, string[]>>;
  face_overrides?: RegionOverrides;
  voice_overrides?: RegionOverrides;
  body_overrides?: RegionOverrides;
  allow_narration: boolean;
  allow_extra_dialogue: boolean;
  allow_nonverbal_vocalizations: boolean;
  allowed_sound_events: string[];
  continuity: Continuity;
  explicit_cue_ids?: string[];
}

export interface VoiceBaseline {
  register?: string;
  timbre?: string;
  accent?: string;
  language?: string;
  habitual_pace?: string;
  expressivity?: string;
}

export interface CharacterBaseline {
  label: string;
  voice_reference: string | null;
  visual_reference?: string | null;
  voice_baseline?: VoiceBaseline;
  physical_baseline?: string;
  mobility_constraints?: string[];
  identity_locked: true;
}

export interface BeatTiming {
  coordinate: "seconds" | "normalized" | "text_codepoints";
  start: number;
  end: number;
  anchor_text?: string;
  anchor_occurrence?: number;
}

export interface Beat {
  beat_id: string;
  timing: BeatTiming;
  overrides: PerformanceSettings;
}

export interface AuthoredSoundEvent {
  kind: string;
  start_seconds: number;
  duration_seconds: number;
  direction?: string;
}

export interface Line {
  line_id: string;
  character_id: string;
  spoken_text: string;
  duration_seconds: number | null;
  overrides: PerformanceSettings;
  beats: Beat[];
  authored_sound_events: AuthoredSoundEvent[];
}

export interface AdapterConfig {
  id: string;
  version: string;
  capabilities: Record<string, string>;
  unsupported_policy: string;
}

export interface SceneConfig {
  schema_version: string;
  catalog_version: string;
  scene_id: string;
  character_baselines: Record<string, CharacterBaseline>;
  scene_defaults: PerformanceSettings;
  character_overrides: Record<string, PerformanceSettings>;
  lines: Line[];
  adapter: AdapterConfig;
}

export interface SelectedCue {
  id: string;
  channel: CueChannel;
  region: string;
  text: string;
  source_emotion_id: string;
  intensity: Intensity;
}

export interface ResolvedBeatOutput {
  beat_id: string;
  timing: BeatTiming;
  resolved_settings: ResolvedSettings;
  selected_cue_ids: string[];
  visual_direction: string;
  delivery_direction: string;
}

export interface UnsupportedControl {
  control: string;
  status: string;
  reason: string;
}

export interface CompiledOutput {
  cinematic?: { version: "1.0.0"; action: string; delivery: string };
  schema_version: "1.0.0";
  scene_id: string;
  line_id: string;
  character_id: string;
  spoken_text: string;
  video_direction: string;
  delivery_direction: string;
  performance_json: {
    catalog_version: string;
    resolved_settings: ResolvedSettings;
    selected_cue_ids: string[];
    resolved_beats: ResolvedBeatOutput[];
    beat_notes: string[];
  };
  sound_events: AuthoredSoundEvent[];
  unsupported_controls: UnsupportedControl[];
  warnings: string[];
  resolution_trace: {
    catalog_version: string;
    profile_ids: string[];
    winning_scopes: Record<string, string>;
  };
}

export interface IndexVariant {
  id: string;
  label: string;
  context: string;
}

export interface IndexEmotion {
  id: string;
  label: string;
  state_type: StateType;
  aliases: string[];
  definition: string;
  appraisal: string;
  objective: string;
  variants: IndexVariant[];
}

export interface IndexSubfamily {
  id: string;
  label: string;
  emotions: IndexEmotion[];
}

export interface IndexFamily {
  id: string;
  label: string;
  subfamilies: IndexSubfamily[];
}

export interface CatalogIndex {
  catalog_version: string;
  schema_version: string;
  title: string;
  editorial_notice: string;
  intensity_labels: string[];
  counts: {
    families: number;
    subfamilies: number;
    emotions: number;
    variants: number;
    resolved: number;
  };
  families: IndexFamily[];
}

export type WinningScope =
  | "shot_plan"
  | "runtime_default"
  | "scene_default"
  | "character_override"
  | "line_override"
  | "beat_override";
