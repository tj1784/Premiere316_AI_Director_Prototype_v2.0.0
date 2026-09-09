import { hydrateAudioWorkspace } from "../production/audio-types.ts";
import { hydrateVideoWorkspace } from "../production/video-types.ts";
import { isResearchApproved } from "../research/bible.ts";
import type { Picture, StageId } from "./types.ts";

export type ReadinessStatus = "ready" | "blocked" | "fail-closed" | "imported" | "placeholder";

export type ReadinessItem = {
  id: string;
  stage: StageId;
  label: string;
  status: ReadinessStatus;
  reason: string;
  nextAction: string;
};

export function movieReadiness(picture: Picture): ReadinessItem[] {
  const video = hydrateVideoWorkspace(picture.video);
  const audio = hydrateAudioWorkspace(picture.audio);
  const researchOk = isResearchApproved(picture.research);
  const screenplayOk = picture.screenplay.status === "APPROVED" || Boolean(picture.screenplayFountain.trim());
  const visualContentPresent = [picture.visualDevelopment?.boards, picture.visualDevelopment?.characterBibles, picture.visualDevelopment?.wardrobeStates, picture.visualDevelopment?.locationBibles, picture.visualDevelopment?.propBibles].some((items) => Boolean(items?.length));
  const cinematographyContentPresent = [picture.cinematography?.manifestoVersions, picture.cinematography?.sequenceArcs, picture.cinematography?.shotPlans].some((items) => Boolean(items?.length));
  const performanceContentPresent = Boolean(picture.performance?.beats.length || picture.performance?.shots.length)
    || Object.values(picture.performance?.performance ?? {}).some((directions) => Object.keys(directions).length > 0);
  const hasCanonicalVideo = video.takes.some((take) => take.canonical && take.origin === "imported");
  const hasFailClosedVideo = video.takes.some((take) => take.origin === "fail-closed" || take.status === "FAILED");
  const hasCanonicalAudio = audio.takes.some((take) => take.canonical && take.origin === "imported");
  const hasImportedAudio = audio.takes.some((take) => take.origin === "imported");
  return [
    { id: "research", stage: "research", label: "Research", status: researchOk ? "ready" : "blocked", reason: researchOk ? "Research approved." : "Research bible is not approved.", nextAction: "Open Research and approve." },
    { id: "screenplay", stage: "screenplay", label: "Screenplay", status: screenplayOk ? "ready" : "blocked", reason: screenplayOk ? "Screenplay present." : "No approved or drafted screenplay.", nextAction: "Open Screenplay." },
    { id: "inventory", stage: "inventory", label: "Inventory", status: picture.characters.length ? "ready" : "blocked", reason: picture.characters.length ? `${picture.characters.length} characters.` : "No characters.", nextAction: "Open Inventory." },
    { id: "visual-development", stage: "visual-development", label: "Visual Development", status: visualContentPresent ? "ready" : "placeholder", reason: visualContentPresent ? "Visual development content present." : "Visual development not started.", nextAction: "Open Visual Dev." },
    { id: "cinematography", stage: "cinematography", label: "Cinematography", status: cinematographyContentPresent ? "ready" : "placeholder", reason: cinematographyContentPresent ? "Cinematography content present." : "Cinematography not started.", nextAction: "Open Cinematography." },
    { id: "performance", stage: "performance", label: "Performance", status: performanceContentPresent ? "ready" : "placeholder", reason: performanceContentPresent ? "Performance specs present." : "Performance not started.", nextAction: "Open Performance." },
    { id: "shots", stage: "shots", label: "Shots", status: picture.shots.length ? "ready" : "blocked", reason: picture.shots.length ? `${picture.shots.length} shots.` : "No shots.", nextAction: "Open Shots." },
    { id: "prompts", stage: "prompts", label: "Prompts", status: picture.shots.some((shot) => shot.t2iPrompt) ? "ready" : "placeholder", reason: "Prompt compiler can draft still/motion packages.", nextAction: "Open Prompt Lab and compile drafts." },
    { id: "images", stage: "generate", label: "Images", status: picture.production?.assets?.some((asset) => Boolean(asset.approvedIterationId)) ? "ready" : "placeholder", reason: "Canonical stills require the native FLUX path.", nextAction: "Open Generate." },
    { id: "video", stage: "generate", label: "Video", status: hasCanonicalVideo ? "imported" : hasFailClosedVideo ? "fail-closed" : "blocked", reason: hasCanonicalVideo ? "Canonical imported video present." : "Native H3/LTX generation is blocked. Import or keep fail-closed.", nextAction: hasCanonicalVideo ? "Review canonical imported video." : "Queue fail-closed video or import a real movie file." },
    { id: "voice", stage: "score", label: "Voice", status: hasCanonicalAudio ? "imported" : audio.takes.some((take) => take.kind === "dialogue" && take.origin === "fail-closed") ? "fail-closed" : "blocked", reason: "Qwen3-TTS and VoxCPM2 stay fail-closed until a native runtime exists.", nextAction: "Queue missing dialogue or import voice takes." },
    { id: "sound", stage: "score", label: "Sound", status: hasImportedAudio ? "imported" : "placeholder", reason: "Foley/ambience can be imported. No cloud SFX.", nextAction: "Open Score and import or annotate cues." },
    { id: "score", stage: "score", label: "Score", status: audio.takes.some((take) => take.kind === "score" && take.origin === "fail-closed") ? "fail-closed" : picture.cues.length ? "placeholder" : "blocked", reason: "Music3 is fail-closed.", nextAction: "Open Score." },
    { id: "stitch", stage: "timeline", label: "Stitch/Edit", status: picture.shots.length ? "placeholder" : "blocked", reason: "Timeline can bind canonical imported media and placeholders.", nextAction: "Open Stitch." },
    { id: "master", stage: "export", label: "Master", status: "placeholder", reason: "Mastering waits for FFmpeg and canonical media.", nextAction: "Open Export." },
    { id: "export", stage: "export", label: "Export", status: "placeholder", reason: "Paper exports work. MP4 export requires FFmpeg plus real or imported media.", nextAction: "Open Export." },
  ];
}

export function nextReadinessAction(picture: Picture): ReadinessItem | null {
  return movieReadiness(picture).find((item) => item.status === "blocked" || item.status === "fail-closed") ?? movieReadiness(picture).find((item) => item.status === "placeholder") ?? null;
}
