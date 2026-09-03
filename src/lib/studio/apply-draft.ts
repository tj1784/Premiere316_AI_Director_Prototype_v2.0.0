import { uid } from "../utils";
import type { Picture } from "./types";
import { compilePicture, fountainFrom } from "./prompt-compiler";

export type PictureDraft = {
  title?: string;
  logline?: string;
  genre?: string;
  tone?: string;
  directorNotes?: string;
  acts?: { number: number; name: string }[];
  scenes?: {
    slugline: string;
    summary: string;
    emotionalBeat: string;
    durationSec: number;
    act?: number;
  }[];
  characters?: {
    name: string;
    role: string;
    age: string;
    look: string;
    arc: string;
    voiceId?: string;
  }[];
  locations?: { name: string; description: string; lighting?: string }[];
  props?: { name: string; description: string }[];
  wardrobe?: { name: string; description: string }[];
  vfx?: { name: string; description: string }[];
  shots?: {
    sceneIndex?: number;
    type: string;
    description: string;
    durationSec: number;
    camera?: string;
    lens?: string;
    cameraMove?: string;
    emotion?: string;
    expression?: string;
  }[];
};

export function applyDraft(picture: Picture, draft: PictureDraft): Picture {
  const scenes = (draft.scenes ?? []).map((s, i) => ({
    id: uid("sc"),
    act: s.act ?? 1,
    slugline: s.slugline,
    summary: s.summary,
    emotionalBeat: s.emotionalBeat,
    durationSec: s.durationSec || 12,
  }));
  const characters = (draft.characters ?? []).map((c) => ({
    id: uid("ch"),
    name: c.name,
    role: c.role,
    age: c.age,
    look: c.look,
    arc: c.arc,
    voiceId: c.voiceId || "eve",
  }));
  const shots = (draft.shots ?? []).map((s, i) => ({
    id: uid("sh"),
    sceneId: scenes[s.sceneIndex ?? 0]?.id ?? scenes[0]?.id ?? "sc",
    index: i + 1,
    type: s.type,
    description: s.description,
    durationSec: Math.min(15, Math.max(6, s.durationSec || 10)),
    camera: s.camera || "wide",
    lens: s.lens || "35mm",
    cameraMove: s.cameraMove || "static",
    emotion: s.emotion || "neutral",
    expression: s.expression || "still, listening",
    t2iPrompt: "",
    i2vPrompt: "",
    t2voicePrompt: "",
  }));
  const next: Picture = {
    ...picture,
    title: draft.title || picture.title,
    logline: draft.logline || picture.logline,
    genre: draft.genre || picture.genre,
    tone: draft.tone || picture.tone,
    directorNotes: draft.directorNotes || picture.directorNotes,
    acts: draft.acts ?? picture.acts,
    scenes: scenes.length ? scenes : picture.scenes,
    characters: characters.length ? characters : picture.characters,
    locations: (draft.locations ?? []).map((l) => ({ id: uid("loc"), ...l })),
    props: (draft.props ?? []).map((p) => ({ id: uid("pr"), ...p })),
    wardrobe: (draft.wardrobe ?? []).map((p) => ({ id: uid("w"), ...p })),
    vfx: (draft.vfx ?? []).map((p) => ({ id: uid("v"), ...p })),
    shots: shots.length ? shots : picture.shots,
    stage: "screenplay",
    updatedAt: Date.now(),
  };
  next.screenplayFountain = fountainFrom(next);
  return compilePicture(next);
}
