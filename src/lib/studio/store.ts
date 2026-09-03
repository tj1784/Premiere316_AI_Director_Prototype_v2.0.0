import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SAMPLE_ID, makeSamplePicture } from "./sample";
import type { IdleUnloadOption } from "./residency";
import { DEFAULT_ENGINES, type Picture, type SelectedEngines, type StageId, USAGE_CAPS } from "./types";
import { makePreparationForIntake, migratePicturePreparation, type LegacyPicture } from "./picture-preparation";
import type { PictureIntake } from "./picture-intake";
import { uid } from "../utils";
import { sanitizeProductionBreakdown } from "../production/persistence";
import { migratePicturePerformance } from "../performance/persistence";
import { hydratePictureResearch } from "../research/bible.ts";

interface StudioState {
  pictures: Picture[];
  activeId: string | null;
  stageOverride: StageId | null;
  selectedShotId: string | null;
  stillBayShotId: string | null;
  binTab: "engines" | "assets" | "models";
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  residency: { pinned: Record<string, boolean>; idleUnload: IdleUnloadOption };
  pinResidency: (engine: string, pinned: boolean) => void;
  setIdleUnload: (option: IdleUnloadOption) => void;
  hydrateSample: () => void;
  openSample: () => void;
  newPicture: (intake: PictureIntake) => string;
  openPicture: (id: string) => void;
  closePicture: () => void;
  deletePicture: (id: string) => void;
  patchActive: (patch: Partial<Picture>) => void;
  setStage: (stage: StageId) => void;
  setEngines: (patch: Partial<SelectedEngines>) => void;
  selectShot: (id: string | null) => void;
  openStillBay: (shotId: string) => void;
  closeStillBay: () => void;
  setBinTab: (tab: StudioState["binTab"]) => void;
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  bumpUsage: (key: keyof Picture["usage"], n?: number) => boolean;
  replaceActive: (picture: Picture) => void;
}

function blankPicture(intake: PictureIntake): Picture {
  const id = uid("pic");
  const now = Date.now();
  return {
    id,
    title: intake.title.trim() || "Untitled Picture",
    logline: intake.logline.trim() || intake.premise.trim() || intake.concept.trim(),
    genre: intake.genre.trim() || "Drama",
    tone: intake.tone.trim() || "Cinematic, naturalistic, restrained",
    format: intake.aspectRatio,
    fps: intake.frameRate,
    runtimeMinutes: intake.targetRuntimeMinutes,
    createdAt: now,
    updatedAt: now,
    stage: "research",
    ...makePreparationForIntake(intake, id, now),
    research: hydratePictureResearch(null, intake, now),
    selectedEngine: { ...DEFAULT_ENGINES },
    screenplayFountain: "",
    production: null,
    performance: null,
    acts: [],
    scenes: [],
    characters: [],
    locations: [],
    props: [],
    wardrobe: [],
    vfx: [],
    shots: [],
    cues: [],
    voices: [],
    directorNotes: "",
    usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
  };
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      pictures: [makeSamplePicture()],
      activeId: null,
      stageOverride: null,
      selectedShotId: null,
      stillBayShotId: null,
      binTab: "assets",
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      residency: { pinned: {}, idleUnload: 30 },
      pinResidency: (engine, pinned) =>
        set((s) => ({ residency: { ...s.residency, pinned: { ...s.residency.pinned, [engine]: pinned } } })),
      setIdleUnload: (option) => set((s) => ({ residency: { ...s.residency, idleUnload: option } })),
      hydrateSample: () => {
        const { pictures } = get();
        if (pictures.some((p) => p.sample || p.id === SAMPLE_ID)) return;
        set({ pictures: [migratePicture(makeSamplePicture()), ...pictures] });
      },
      openSample: () => {
        const sample = migratePicture(makeSamplePicture());
        set((s) => {
          const rest = s.pictures.filter((p) => !p.sample && p.id !== SAMPLE_ID);
          return {
            pictures: [sample, ...rest],
            activeId: SAMPLE_ID,
            stageOverride: null,
            selectedShotId: null,
            stillBayShotId: null,
          };
        });
      },
      newPicture: (intake) => {
        const picture = blankPicture(intake);
        set((s) => ({
          pictures: [picture, ...s.pictures],
          activeId: picture.id,
          stageOverride: "research",
          selectedShotId: null,
        }));
        return picture.id;
      },
      openPicture: (id) => {
        const exists = get().pictures.some((p) => p.id === id);
        if (!exists && (id === SAMPLE_ID || !id)) {
          get().openSample();
          return;
        }
        if (!exists) return;
        const picture = get().pictures.find((item) => item.id === id)!;
        set({ activeId: id, stageOverride: picture.lastOpenedStage, selectedShotId: null });
      },
      closePicture: () => set({ activeId: null, selectedShotId: null, stillBayShotId: null }),
      deletePicture: (id) =>
        set((s) => ({
          pictures: s.pictures.filter((p) => p.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        })),
      patchActive: (patch) => {
        const { activeId } = get();
        if (!activeId) return;
        set((s) => ({
          pictures: s.pictures.map((p) =>
            p.id === activeId ? { ...p, ...patch, updatedAt: Date.now() } : p,
          ),
        }));
      },
      setStage: (stage) => {
        set({ stageOverride: stage });
        const { activeId } = get();
        if (!activeId) return;
        set((s) => ({
          pictures: s.pictures.map((p) => (p.id === activeId ? { ...p, stage, lastOpenedStage: stage, updatedAt: Date.now() } : p)),
        }));
      },
      setEngines: (patch) => {
        const pic = get().pictures.find((p) => p.id === get().activeId);
        if (!pic) return;
        get().patchActive({ selectedEngine: { ...pic.selectedEngine, ...patch } });
      },
      selectShot: (id) => set({ selectedShotId: id }),
      openStillBay: (shotId) => set({ stillBayShotId: shotId, selectedShotId: shotId }),
      closeStillBay: () => set({ stillBayShotId: null }),
      setBinTab: (tab) => set({ binTab: tab }),
      setLeftPanelCollapsed: (leftPanelCollapsed) => set({ leftPanelCollapsed }),
      setRightPanelCollapsed: (rightPanelCollapsed) => set({ rightPanelCollapsed }),
      bumpUsage: (key, n = 1) => {
        const pic = get().pictures.find((p) => p.id === get().activeId);
        if (!pic) return false;
        const next = pic.usage[key] + n;
        if (next > USAGE_CAPS[key]) return false;
        get().patchActive({ usage: { ...pic.usage, [key]: next } });
        return true;
      },
      replaceActive: (picture) => {
        const { activeId } = get();
        if (!activeId) return;
        set((s) => ({
          pictures: s.pictures.map((p) => (p.id === activeId ? { ...picture, id: activeId } : p)),
        }));
      },
    }),
    {
      name: "premiere316-v302-c",
      skipHydration: true,
      partialize: (s) => ({
        pictures: s.pictures.map((p) => ({
          ...p,
          shots: p.shots.map((sh) => ({
            ...sh,
            stillUrl: sh.stillUrl?.startsWith("data:") ? undefined : sh.stillUrl,
            videoUrl: sh.videoUrl?.startsWith("data:") ? undefined : sh.videoUrl,
          })),
          voices: p.voices.map((v) => ({ ...v, audioDataUrl: undefined })),
        })),
        activeId: s.activeId,
        stageOverride: s.stageOverride,
        residency: s.residency,
        binTab: s.binTab,
        leftPanelCollapsed: s.leftPanelCollapsed,
        rightPanelCollapsed: s.rightPanelCollapsed,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StudioState>;
        const pictures = (p.pictures ?? current.pictures).map((picture) => migratePicture(picture as LegacyPicture));
        const hasSample = pictures.some((x) => x.sample || x.id === SAMPLE_ID);
        const pics = hasSample ? pictures : [migratePicture(makeSamplePicture()), ...pictures];
        const liveId = current.activeId;
        const persistedId = p.activeId ?? null;
        const pickId = (id: string | null) => (id && pics.some((x) => x.id === id) ? id : null);
        return {
          ...current,
          ...p,
          pictures: pics,
          activeId: pickId(liveId) ?? pickId(persistedId),
          stageOverride: normalizeStage(current.stageOverride ?? p.stageOverride),
          residency: p.residency ?? current.residency,
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.hydrateSample();
      },
    },
  ),
);

function migratePicture(picture: LegacyPicture): Picture {
  const prepared = migratePicturePreparation(picture);
  const productionReady = { ...prepared, production: sanitizeProductionBreakdown(prepared.production) };
  const withPerformance = { ...productionReady, performance: migratePicturePerformance(productionReady) };
  return { ...withPerformance, research: hydratePictureResearch(withPerformance.research, withPerformance.intake) };
}

export function useActivePicture(): Picture | null {
  return useStudio((s) => s.pictures.find((p) => p.id === s.activeId) ?? null);
}

export function useStage(): StageId {
  const override = useStudio((s) => s.stageOverride);
  const picture = useActivePicture();
  return normalizeStage(override ?? picture?.stage) ?? "intake";
}

function normalizeStage(stage: unknown): StageId | null {
  if (stage === "brief") return "intake";
  return typeof stage === "string" && ["intake", "research", "screenplay", "inventory", "performance", "shots", "prompts", "generate", "timeline", "score", "export"].includes(stage)
    ? stage as StageId
    : null;
}
