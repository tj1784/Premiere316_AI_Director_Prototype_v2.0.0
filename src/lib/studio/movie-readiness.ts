import { hydrateAudioWorkspace } from "../production/audio-types.ts";
import { hydrateVideoWorkspace } from "../production/video-types.ts";
import { isResearchApproved } from "../research/bible.ts";
import type { Picture, StageId } from "./types.ts";
import { stableHash } from "../production/dependency-graph.ts";
import { movieAssemblyPlan } from "./movie-assembly.ts";

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
  const currentAudio = audio.takes.filter(take => take.canonical && take.probe?.ok && take.mediaSha256 && (!take.cueFingerprint || take.cueFingerprint === stableHash(audio.cues.find(cue => cue.id === take.cueId))));
  const score = currentAudio.find(take => take.kind === "score");
  const sound = currentAudio.find(take => !["score","dialogue"].includes(take.kind));
  const assembly = movieAssemblyPlan(picture);
  const delivery = picture.movieAssemblies?.at(-1);
  const deliveryCurrent = Boolean(delivery && assembly.ok && stableHash(delivery.plan) === stableHash(assembly));
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
    { id: "video", stage: "generate", label: "Video", status: hasCanonicalVideo ? "imported" : hasFailClosedVideo ? "fail-closed" : "blocked", reason: hasCanonicalVideo ? "Canonical imported video present; delivery rechecks source freshness." : "No canonical video takes. Use the selected workflow's actual readiness and review its outputs.", nextAction: "Open Jobs & takes or import reviewed video." },
    { id: "voice", stage: "score", label: "Voice", status: hasCanonicalAudio ? "imported" : audio.takes.some((take) => take.kind === "dialogue" && take.origin === "fail-closed") ? "fail-closed" : "blocked", reason: "Qwen3-TTS and VoxCPM2 stay fail-closed until a native runtime exists.", nextAction: "Queue missing dialogue or import voice takes." },
    { id: "sound", stage: "score", label: "Sound", status: sound ? sound.origin === "imported" ? "imported" : "ready" : hasImportedAudio ? "imported" : "placeholder", reason: sound ? "Current reviewed sound take present." : "Author source-bound cues, then import or explicitly render with configured Small-SFX and review.", nextAction: "Open Sound & music." },
    { id: "score", stage: "score", label: "Score", status: score ? score.origin === "imported" ? "imported" : "ready" : audio.cues.some(c=>c.kind==="score") || picture.cues.length ? "placeholder" : "blocked", reason: score ? "Current reviewed score take present." : "Author score direction, then import or explicitly render with configured ACE-Step XL SFT and review.", nextAction: "Open Sound & music." },
    { id: "stitch", stage: "timeline", label: "Stitch/Edit", status: picture.shots.length ? "placeholder" : "blocked", reason: "Timeline can bind canonical imported media and placeholders.", nextAction: "Open Stitch." },
    { id: "master", stage: "export", label: "Master", status: assembly.ok ? "ready" : "placeholder", reason: assembly.ok ? "Selected media and cue timing are ready for explicit full-length assembly; disk bytes are checked at execution." : assembly.issues[0] ?? "Mastering waits for reviewed media.", nextAction: "Open Delivery." },
    { id: "export", stage: "export", label: "Export", status: deliveryCurrent && delivery?.reviews?.at(-1)?.decision === "approve" ? "ready" : "placeholder", reason: delivery ? deliveryCurrent ? "Rendered delivery exists; retain its separate final viewing/listening review." : "Historical delivery retained; sources have changed." : "Source/prompt exports work. Full MP4 assembly requires reviewed current media and local FFmpeg.", nextAction: "Open Delivery." },
  ];
}

export function nextReadinessAction(picture: Picture): ReadinessItem | null {
  return movieReadiness(picture).find((item) => item.status === "blocked" || item.status === "fail-closed") ?? movieReadiness(picture).find((item) => item.status === "placeholder") ?? null;
}
