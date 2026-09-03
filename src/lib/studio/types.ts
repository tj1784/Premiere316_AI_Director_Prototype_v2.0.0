export { MODEL_ROOT } from "./model-catalog.ts";
import type { PictureIntake } from "./picture-intake.ts";
import type { PictureScreenplay } from "./screenplay.ts";
import type { ProductionBreakdown } from "../production/types.ts";
import type { PerformanceWorkspace } from "../performance/types.ts";
import type { PictureResearchBible } from "../research/bible.ts";

export const USAGE_CAPS = {
  llm: 24,
  stills: 8,
  clips: 4,
  tts: 6,
} as const;

export type StageId =
  | "intake"
  | "research"
  | "screenplay"
  | "inventory"
  | "performance"
  | "shots"
  | "prompts"
  | "generate"
  | "timeline"
  | "score"
  | "export";

export const STAGES: { id: StageId; number: string; label: string }[] = [
  { id: "intake", number: "01", label: "Intake" },
  { id: "research", number: "02", label: "Research" },
  { id: "screenplay", number: "03", label: "Screenplay" },
  { id: "inventory", number: "04", label: "Inventory" },
  { id: "performance", number: "05", label: "Performance" },
  { id: "shots", number: "06", label: "Shots" },
  { id: "prompts", number: "07", label: "Prompt Lab" },
  { id: "generate", number: "08", label: "Generate" },
  { id: "timeline", number: "09", label: "Stitch" },
  { id: "score", number: "10", label: "Score" },
  { id: "export", number: "11", label: "Export" },
];

export type EngineKind =
  | "director"
  | "image"
  | "video"
  | "voice"
  | "music"
  | "tool"
  | "heritage";

export type SelectedEngines = {
  director: string;
  image: string;
  video: string;
  voice: string;
  music: string;
};

export const DEFAULT_ENGINES: SelectedEngines = {
  director: "dramatron",
  image: "flux2",
  video: "ltx-2",
  voice: "index-tts",
  music: "minimax-music3",
};

export type Act = { number: number; name: string };
export type Scene = {
  id: string;
  act: number;
  slugline: string;
  summary: string;
  emotionalBeat: string;
  durationSec: number;
};
export type Character = {
  id: string;
  name: string;
  role: string;
  age: string;
  look: string;
  arc: string;
  voiceId: string;
};
export type Asset = { id: string; name: string; description: string; lighting?: string };
export type Shot = {
  id: string;
  sceneId: string;
  index: number;
  type: string;
  description: string;
  durationSec: number;
  camera: string;
  lens: string;
  cameraMove: string;
  emotion: string;
  expression: string;
  t2iPrompt: string;
  i2vPrompt: string;
  t2voicePrompt: string;
  stillUrl?: string;
  videoUrl?: string;
};
export type Cue = {
  id: string;
  name: string;
  startSec: number;
  durationSec: number;
  mood: string;
  instruments: string;
  minimaxPrompt: string;
  sfx: string;
};
export type VoiceTake = {
  id: string;
  character: string;
  text: string;
  voiceId: string;
  audioDataUrl?: string;
};

export type Picture = {
  id: string;
  title: string;
  logline: string;
  genre: string;
  tone: string;
  format: string;
  fps: number;
  runtimeMinutes: number;
  createdAt: number;
  updatedAt: number;
  stage: StageId;
  lastOpenedStage: StageId;
  thumbnailUrl: string | null;
  intake: PictureIntake;
  screenplay: PictureScreenplay;
  research?: PictureResearchBible | null;
  production?: ProductionBreakdown | null;
  performance?: PerformanceWorkspace | null;
  selectedEngine: SelectedEngines;
  screenplayFountain: string;
  acts: Act[];
  scenes: Scene[];
  characters: Character[];
  locations: Asset[];
  props: Asset[];
  wardrobe: Asset[];
  vfx: Asset[];
  shots: Shot[];
  cues: Cue[];
  voices: VoiceTake[];
  directorNotes: string;
  usage: { llm: number; stills: number; clips: number; tts: number };
  sample?: boolean;
};
