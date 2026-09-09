import { DEFAULT_ENGINES, type Picture } from "./types.ts";
import { compilePicture, fountainFrom } from "./prompt-compiler.ts";
import { migratePicturePreparation, type LegacyPicture } from "./picture-preparation.ts";

export const SAMPLE_ID = "pic_last_reel";
export const RED_SEA_THUMBNAIL_URL = "/stills/red-sea-visual-direction.jpg";

export function makeSamplePicture(): Picture {
  const picture: LegacyPicture = {
    id: SAMPLE_ID,
    title: "The Last Reel",
    logline:
      "A night-shift conservator at a coastal film archive threads a unlabeled 35mm reel and watches the last night of a director who vanished in 1978 — then realizes the film is still being shot.",
    genre: "Quiet supernatural drama",
    tone: "Photoreal cinematic, 35mm, tungsten practicals, rain on glass, restrained",
    format: "16:9",
    fps: 24,
    runtimeMinutes: 2,
    createdAt: 1,
    updatedAt: 1,
    stage: "timeline",
    selectedEngine: { ...DEFAULT_ENGINES },
    screenplayFountain: "",
    acts: [
      { number: 1, name: "The archive" },
      { number: 2, name: "The hood" },
    ],
    scenes: [
      {
        id: "sc1",
        act: 1,
        slugline: "EXT. COASTAL ARCHIVE — NIGHT",
        summary: "Rain on the pier. The archive sits like a ship of cans.",
        emotionalBeat: "solitude",
        durationSec: 23,
      },
      {
        id: "sc2",
        act: 1,
        slugline: "INT. STEENBECK ROOM — NIGHT",
        summary: "Elias threads an unlabeled reel. The hood already has a cliff.",
        emotionalBeat: "focus cracking into dread",
        durationSec: 37,
      },
      {
        id: "sc3",
        act: 2,
        slugline: "EXT. CLIFF — 1978 — NIGHT",
        summary: "Halden looks back into the camera that should not exist yet.",
        emotionalBeat: "recognition",
        durationSec: 27,
      },
    ],
    characters: [
      {
        id: "ch1",
        name: "Elias Voss",
        role: "Conservator",
        age: "late 40s",
        look: "Lean, grey at the temples, linen shirt under a wool cardigan, tired precise hands.",
        arc: "From caretaker of the dead to witness of a living cut.",
        voiceId: "ara",
      },
      {
        id: "ch2",
        name: "Mara Halden",
        role: "Vanished director",
        age: "mid 30s, 1978",
        look: "Wind-cut hair, navy peacoat, 16mm camera strap, salt on the collar.",
        arc: "A last look that refuses to stay in 1978.",
        voiceId: "eve",
      },
    ],
    locations: [
      {
        id: "loc1",
        name: "Coastal archive",
        description: "Cedar and corrugated steel on a working pier. Sodium lamps, rain.",
        lighting: "Sodium practicals, wet reflections",
      },
      {
        id: "loc2",
        name: "Steenbeck room",
        description: "Windowless vault of cans. One Steenbeck, one desk lamp.",
        lighting: "Tungsten desk lamp, machine glow",
      },
    ],
    props: [
      { id: "pr1", name: "Unlabeled 35mm reel", description: "No leader marks. Warm stock. Metal core." },
      { id: "pr2", name: "Steenbeck", description: "Flatbed editor, scratched glass, humming motor." },
    ],
    wardrobe: [
      { id: "w1", name: "Elias night shift", description: "Wool cardigan, rolled sleeves, cotton gloves off." },
      { id: "w2", name: "Halden 1978", description: "Peacoat, salt-stiff scarf, practical boots." },
    ],
    vfx: [{ id: "v1", name: "Hood bloom", description: "The projected cliff holds a second longer than the motor." }],
    shots: [
      shot(1, "sc1", "establishing", 12, "Wide of the archive on the pier in rain.", "static", "quiet awe", "still, watchful, rain in the lashes"),
      shot(2, "sc1", "coverage", 11, "Corridor of cans, Elias walking into the dark.", "dolly in", "unease", "mouth set, eyes scanning labels"),
      shot(3, "sc2", "closeup", 8, "Elias at the Steenbeck, tired and precise.", "slow push", "concentration", "micro-frown, held breath"),
      shot(4, "sc2", "insert", 6, "The unlabeled reel on the metal table.", "macro static", "curiosity", "hands enter, careful"),
      shot(5, "sc2", "coverage", 10, "Over-shoulder threading, cliff already on the hood.", "handheld settle", "dread", "widening eyes, no blink"),
      shot(6, "sc3", "establishing", 15, "Halden on the cliff, looking back into camera.", "slow rise", "defiance", "wind in hair, a almost-smile that isn't"),
      shot(7, "sc3", "closeup", 13, "Elias sees himself in the hood glass.", "locked off", "recognition", "blood leaving the face, lips parted"),
      shot(8, "sc1", "establishing", 12, "Return to the archive. The lights hold.", "static", "aftershock", "empty doorway, one lamp still on"),
    ],
    cues: [
      {
        id: "cue1",
        name: "Pier rain",
        startSec: 0,
        durationSec: 23,
        mood: "lonely, wet, analog",
        instruments: "prepared piano, tape hiss, distant bell",
        minimaxPrompt: "Sparse prepared piano over analog tape hiss and rain, no drums, 70bpm, coastal night.",
        sfx: "rain on corrugated steel, gull far off, door latch",
      },
      {
        id: "cue2",
        name: "Threading",
        startSec: 23,
        durationSec: 37,
        mood: "mechanical intimacy turning wrong",
        instruments: "low cello drone, sprocket clicks as percussion",
        minimaxPrompt: "Low cello drone with sprocket-click rhythm, slowly detuning, no melody until the last bar.",
        sfx: "Steenbeck motor, film slap, breath",
      },
      {
        id: "cue3",
        name: "The look back",
        startSec: 60,
        durationSec: 27,
        mood: "recognition, salt wind",
        instruments: "high strings harmonic, analog choir pad",
        minimaxPrompt: "High string harmonic and analog choir pad, wind in the high end, unresolved cadence.",
        sfx: "wind, 16mm camera wind, surf",
      },
    ],
    voices: [
      {
        id: "vo1",
        character: "Elias Voss",
        text: "No leader. No slate. Whoever cut this didn't want it found.",
        voiceId: "ara",
      },
    ],
    directorNotes: "Hold faces. Never cut on the blink. The hood is a second camera.",
    usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
    sample: true,
  };
  picture.screenplayFountain = fountainFrom(picture as Picture);
  return compilePicture(migratePicturePreparation(picture));
}

function shot(
  index: number,
  sceneId: string,
  type: string,
  durationSec: number,
  description: string,
  cameraMove: string,
  emotion: string,
  expression: string,
) {
  return {
    id: `sh${index}`,
    sceneId,
    index,
    type,
    description,
    durationSec,
    camera: type === "closeup" ? "close" : type === "insert" ? "macro" : "wide",
    lens: type === "closeup" ? "85mm" : type === "insert" ? "50mm macro" : "35mm",
    cameraMove,
    emotion,
    expression,
    t2iPrompt: "",
    i2vPrompt: "",
    t2voicePrompt: "",
  };
}
