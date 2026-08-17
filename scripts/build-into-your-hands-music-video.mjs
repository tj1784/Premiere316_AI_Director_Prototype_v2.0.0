import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../server/projects.js";
import { loadStoryboard, saveStoryboard } from "../server/storyboard.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectSlug = "harrowing_of_hell";
const projectRoot = path.join(repoRoot, "projects", projectSlug);
const storyboardFile = path.join(projectRoot, "production", "storyboard.json");
const manifestDir = path.join(projectRoot, "production", "music-video", "into-your-hands");
const manifestFile = path.join(manifestDir, "manifest.json");
const openingName = "MV-Into-Your-Hands-opening.v3-9x16-crown-passion.png";
const openingFile = path.join(projectRoot, "media", "storyboard", openingName);
const soundtrackName = "into-your-hands-passion-master.v1.flac";
const soundtrackFile = path.join(projectRoot, "media", "audio", soundtrackName);
const workingAudioName = "into-your-hands-passion-ltx-48k-stereo-242s.v1.flac";
const workingAudioFile = path.join(projectRoot, "media", "audio", workingAudioName);

const fps = 24;
const width = 576;
const height = 1024;
const totalFrames = 5808;
const chapterId = "MV01";
const openingSha256 = "df5fc546accf9af95c060a70e23f252b26f14ff0c936323f733130e3f26b547c";
const openingBytes = 2323733;
const soundtrackSha256 = "7f1f4f645ec66fd8fb695027a19056d5abc93f595ea6f90bb0355f4d2c051b0f";
const soundtrackBytes = 25930348;
const identityAssetId = "character-jesus-the-harrower-close-up";
const identityVersion = 3;
const identityFile = "char-jesus-close.v3.png";
const identitySha256 = "0c44bbdf2ebced2b76011c1fa59a7edcff75ef184b42e079da796bd7d8d109be";

const globalPrompt = `Photorealistic live-action vertical Passion-of-Christ music video in true 9:16 composition. The same Jesus remains recognizable in every appearance: a mature olive-brown Middle Eastern Jewish man with a long angular oval face, deep-set brown eyes, a strong narrow slightly convex nose, shoulder-length dense dark wavy hair, a full tapered dark beard, a tall broad-shouldered sturdy manual-labor build, wide chest, strong neck, substantial shoulders and powerful arms. He must never become thin, delicate, glamorized, youthful, or bodybuilder-exaggerated. Use historically grounded Judean material culture, weathered off-white linen, natural skin and fabric physics, restrained 35 mm film texture, deep readable blacks, storm-blue shadows and motivated warm light. The video cold-opens at the crucifixion with an unmistakable thick woven crown of thorns and a harsh battered Passion-film appearance, then deliberately flashes back to Gethsemane where the crown is historically absent. The crown returns after Roman mocking and remains prominent through the way of the cross and crucifixion. Preserve intense but non-graphic suffering through exhaustion, dirt, sweat, bruised discoloration, distressed makeup, stained torn linen and weight-bearing strain. Maintain one Jesus, coherent geography, correct anatomy, stable hands, face, hair, beard, wardrobe, crown state and screen direction. Every shot is a single continuous take driven by the supplied song; use the lyric cue only as emotional timing and generate no visible text, captions, logos or watermarks. The original soundtrack is immutable and will be remuxed once into the final master.`;

const shots = [
  [0, 160, "Intro instrumental", "Begin exactly from the approved portrait crucifixion frame. Jesus bears his weight on the cross in a native vertical medium-wide composition; his broad shoulders and powerful arms strain naturally, the thick crown of thorns is fully readable, storm clouds move slowly and distant Jerusalem sits below. Hold identity and the severe battered Passion-film makeup while the camera makes an almost imperceptible upward push."],
  [160, 320, "Father... Into Your hands", "Continue from the prior boundary on the cross. Move into an intimate three-quarter portrait as Jesus lifts his exhausted eyes, draws one labored breath and silently forms the prayer carried by the song. Keep the crown prominent, the sturdy build and suspension tension believable, and the face exact; wind moves wet hair and torn stained linen without a cut."],
  [320, 560, "The sky has lost its color / The earth has learned Your name", "A motivated flash of storm light transforms the crucifixion background into a memory of Gethsemane. The camera passes through dark olive branches and settles on the same Jesus rising beneath a colorless night sky, now before arrest and therefore without the crown. Preserve his broad build, face and dark hair while the cross remains only a distant branch-shaped visual echo."],
  [560, 736, "Love hangs between the heavens / And bears the weight of shame", "In Gethsemane, follow Jesus in a solemn vertical medium-wide as he stands isolated between dark earth and moonless sky. His mantle pulls in the wind, his hands clasp then release near his chest, and cross-shaped branch negative space foreshadows the sacrifice; no crown yet, no cut."],
  [736, 912, "No answer in the thunder / No mercy in the crowd", "Torch-bearing guards and a restless arrest party emerge far behind the olive trunks. Track laterally with Jesus in the foreground as distant thunder rolls; he remains still, broad-shouldered and resolute, forehead clean before the Roman mocking, while the crowd grows more oppressive."],
  [912, 1088, "Only the breath You offer / Growing weaker now", "Tight vertical three-quarter portrait in the garden. Show controlled breath, sweat, tears and trembling fingers, with realistic pores, beard and wet curls; the camera barely drifts as torchlight strengthens behind him. Preserve the exact approved face and sturdy neck and shoulders; no crown."],
  [1088, 1240, "Still You remain / Still You forgive", "Judas approaches and completes the betrayal while Jesus answers with calm compassion rather than anger. Keep both men spatially coherent, Jesus foremost and recognizable, then let a guard surge into the edge of frame as the camera retreats on the established axis."],
  [1240, 1440, "Still in the dying / You teach us how to live", "Jesus restores the injured servant with one restrained gesture, then turns and is led from the garden into a narrow torchlit stone passage. Track backward in portrait framing, holding his face and powerful silhouette as the garden darkness closes behind him."],
  [1440, 1616, "There is no depth You would not enter", "Bound Jesus walks through a torchlit tribunal corridor between Roman guards. His forehead is not yet crowned; his broad manual-labor build remains apparent beneath weathered linen, his face bruised and exhausted but composed, and the centered camera tracks backward smoothly."],
  [1616, 1848, "No wound You would refuse / No night so dark", "In Pilate's courtyard, the crowd surges vertically behind columns while Jesus stands in the center under oppressive architecture. Roman mocking begins and a rough crown of thorns is pressed into his hairline; treat the ordeal through intense historical film makeup without graphic detail, preserving his exact identity and steady gaze."],
  [1848, 2024, "No soul so broken You would not choose", "Low tracking detail of sandaled feet, torn robe hem and the crossbeam beginning to drag over dusty stone. Rise just enough to reveal Jesus now wearing the unmistakable crown of thorns, his strong shoulders accepting the weight as the procession starts."],
  [2024, 2216, "From the dust / Into the sorrow", "A portrait wide follows the Via Dolorosa procession uphill. Jesus carries the cross with slow physically weighted steps, crown visible, face and broad torso consistent, while the crowd remains secondary and vertical stone walls compress the frame."],
  [2216, 2440, "From the garden / To the tree / Every step became surrender", "Jesus falls under the cross and Simon reaches to lift the beam. Focus on strained arms, hands, eye contact and the transfer of weight rather than spectacle; retain the crown, battered makeup, sturdy anatomy and one coherent camera axis as Jesus rises."],
  [2440, 2640, "Every wound became mercy / Father... Into Your hands", "The cross is raised against a darkening vertical sky. Begin near the crowned face and broad chest, then crane upward with the timber as the world falls away below; preserve the harsh weathered Passion appearance, correct anatomy and solemn restraint."],
  [2640, 2880, "If the grave could hold the morning", "Golgotha becomes a monumental portrait tableau as daylight collapses into storm-blue darkness. Slowly dolly away from Jesus on the raised cross, crown and stained linen readable, witnesses small below, and a narrow warm horizon quietly foreshadowing dawn."],
  [2880, 3024, "If the stone could silence light", "Inside the temple, a massive veil tears from top to bottom while lamps sway and dust falls in a grounded earthquake. The vertical camera tilts with the falling fabric; no fantasy beam, no visible text, and the music supplies the force."],
  [3024, 3176, "Then let darkness keep its kingdom", "Return to Jesus for his final breath in a restrained close-medium crucifixion portrait. The crown remains unmistakable, his broad body settles under exhaustion, his head lowers naturally and the storm light fades without a cut or identity drift."],
  [3176, 3344, "But the dawn has learned to rise", "Pull back to a vast storm-lit cross silhouette with Mary and witnesses at its foot. Keep Jesus' recognizable crowned profile and broad form readable against the sky while the camera performs a slow frontal arc that never passes behind him."],
  [3344, 3520, "The veil is torn / The earth is waking", "The body is lowered carefully from the cross into Mary's arms. Use tactile linen, coherent hands and grieving faces in an intimate vertical Pieta composition; the crown remains with the Passion state, the action reverent and non-graphic."],
  [3520, 3696, "Death itself has lost its claim", "A burial procession carries the linen-wrapped body toward a rock-cut tomb. Warm oil lamps move through blue dusk in a vertical procession; the camera walks backward, preserving weight, faces, cloth and ancient stone geography."],
  [3696, 3888, "Instrumental break", "The tomb stone rolls shut with heavy physical momentum. Hold the exterior in moonlight as mourners recede, clouds accelerate subtly and dew gathers; the camera locks into a reverent portrait composition for the instrumental breath."],
  [3888, 4032, "Jesus... Into Your hands", "Mary waits at a distance before the sealed tomb, veil moving in cold wind. A very slow push-in shows grief turning toward expectation while the stone and garden geography remain unchanged."],
  [4032, 4176, "If the grave could hold the morning", "Predawn blue settles over the tomb and olive grove. Dew, still branches and the sealed stone fill the vertical frame as the camera advances almost imperceptibly toward the entrance; no person appears yet."],
  [4176, 4320, "If the stone could silence light / Then let darkness keep its kingdom", "Macro stone texture and fine fissures become visible as the first warm line reaches the tomb edge. Wind rises, dust lifts and the heavy stone begins to respond physically, withholding the resurrection reveal until the next block."],
  [4320, 4456, "But the dawn has learned to rise", "Dawn breaks over the garden. Crane upward in portrait framing as gold enters the formerly blue palette and the tomb stone shifts farther, surrounding olive leaves catching the first light."],
  [4456, 4600, "The veil is torn / The earth is waking", "The ground trembles and the tomb opens fully. Folded burial linen stirs in natural morning light while dust drifts from the doorway; keep the event grounded and physical, with no visible angel required."],
  [4600, 4728, "Death itself has lost its claim", "Mary enters the empty tomb and discovers folded linen. Use intimate handheld breathing and a slow turn toward the doorway, conveying astonishment rather than spectacle; maintain exact tomb geography and natural dawn exposure."],
  [4728, 4912, "Jesus... Jesus... You carried us", "Outside the tomb, resurrected Jesus is revealed from backlit silhouette into the exact approved face. He is again tall, broad-shouldered and sturdy, wearing clean layered off-white linen with no crown, while a gentle forward move allows Mary to recognize him."],
  [4912, 5128, "Through every darkness / Through every scar", "Jesus meets Mary and then the disciples through a connected sequence of compassionate gestures. Preserve one face, broad build and clean resurrection wardrobe; use restrained human joy, stable hands and warm morning light rather than fantasy spectacle."],
  [5128, 5288, "Through the cross / Through the grave / Into the arms of God", "Begin on Jesus' scarred but healed hands, then use motivated match transitions from the empty cross to the open tomb and a sunlit embrace. Keep each image vertical, photoreal and emotionally restrained, with no crown in the resurrection state."],
  [5288, 5424, "Into the arms of God / Jesus", "A wide sunrise gathering forms around Jesus in the olive grove. The camera makes a slow partial circle while staying on the established front axis; faces, wardrobe, scale and warm dawn direction remain stable."],
  [5424, 5568, "Into Your hands", "Jesus stands alone on a ridge above Jerusalem with open relaxed hands. A quiet devotional profile shows the same approved face and powerful but unthreatening build as wind moves his off-white mantle; no crown, no visible wounds beyond restrained continuity."],
  [5568, 5688, "Into Your hands / I give my life", "A disciple kneels in surrendered prayer and Jesus offers one anatomically correct hand. Frame the exchange as an intimate vertical close-medium, with restrained tears, gentle eye contact and the city softly glowing below."],
  [5688, 5808, "Instrumental tail and fade", "End on the empty tomb entrance with the distant cross silhouetted at sunrise. Birds lift through the vertical frame as the camera slowly rises and the picture eases into black over the song's final 0.129-second padded hold; no text or logo."],
].map(([startFrame, endFrame, lyricCue, prompt], index) => ({
  index,
  id: `mv-shot-${String(index + 1).padStart(3, "0")}`,
  startFrame,
  endFrame,
  length: endFrame - startFrame,
  generationFrames: endFrame - startFrame + 1,
  lyricCue,
  prompt
}));

const blockSpecs = [
  { id: "music-video-block-01", sceneId: "MV01-S01", title: "The Cross and Gethsemane", startFrame: 0, endFrame: 1440 },
  { id: "music-video-block-02", sceneId: "MV01-S02", title: "Trial and Way of the Cross", startFrame: 1440, endFrame: 2880 },
  { id: "music-video-block-03", sceneId: "MV01-S03", title: "Death, Burial and the Sealed Tomb", startFrame: 2880, endFrame: 4320 },
  { id: "music-video-block-04", sceneId: "MV01-S04", title: "Resurrection and Final Climax", startFrame: 4320, endFrame: 5808 }
];

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function assertFile(file, bytes, sha256, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} is missing: ${file}`);
  const stat = fs.statSync(file);
  if (stat.size !== bytes) throw new Error(`${label} bytes changed: expected ${bytes}, received ${stat.size}`);
  const actual = sha256File(file);
  if (actual !== sha256.toLowerCase()) throw new Error(`${label} SHA-256 changed: ${actual}`);
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function slug(value) {
  return String(value).toLowerCase();
}

function validateShotPlan() {
  if (shots.length !== 34) throw new Error(`Expected 34 shots, received ${shots.length}`);
  let cursor = 0;
  for (const shot of shots) {
    if (shot.startFrame !== cursor) throw new Error(`${shot.id} starts at ${shot.startFrame}; expected ${cursor}`);
    if (shot.length < 120 || shot.length > 240) throw new Error(`${shot.id} is outside the 5-10 second contract`);
    if (shot.length % 8 !== 0) throw new Error(`${shot.id} editorial length is not divisible by 8`);
    if ((shot.generationFrames - 1) % 8 !== 0) throw new Error(`${shot.id} does not satisfy 8n+1`);
    cursor = shot.endFrame;
  }
  if (cursor !== totalFrames) throw new Error(`Shot plan ends at ${cursor}; expected ${totalFrames}`);
  for (const block of blockSpecs) {
    const blockShots = shots.filter((shot) => shot.startFrame >= block.startFrame && shot.endFrame <= block.endFrame);
    if (!blockShots.length || blockShots[0].startFrame !== block.startFrame || blockShots.at(-1).endFrame !== block.endFrame) {
      throw new Error(`${block.id} is not covered exactly by shots`);
    }
  }
}

validateShotPlan();
assertFile(openingFile, openingBytes, openingSha256, "Portrait crown opening guide");
assertFile(soundtrackFile, soundtrackBytes, soundtrackSha256, "Original MiniMax soundtrack");
if (!fs.existsSync(workingAudioFile)) throw new Error(`48 kHz LTX conditioning file is missing: ${workingAudioFile}`);

const project = loadProject(projectSlug);
const identityAsset = project.assets?.items?.find((item) => item.id === identityAssetId);
const identityRecord = identityAsset?.versions?.find((item) => Number(item.v) === identityVersion);
const identityHash = identityRecord?.fileHashes?.find((item) => item.file === identityFile);
if (!identityAsset || !identityRecord || identityRecord.file !== identityFile || identityHash?.sha256?.toLowerCase() !== identitySha256) {
  throw new Error("Pinned Jesus close-up v3 identity no longer matches the authored project version");
}

const current = loadStoryboard(projectSlug);
if (current.chapters[chapterId] || current.chapterOrder.includes(chapterId)) {
  throw new Error("MV01 already exists. This builder is additive and refuses to replace an existing music-video chapter.");
}
const storyboard = structuredClone(current);
const baseRuntimeFrames = Number(storyboard.runtimeFrames) || 0;
const maxChapterNumber = Math.max(0, ...Object.values(storyboard.chapters).map((item) => Number(item.number) || 0));
const maxSceneNumber = Math.max(0, ...Object.values(storyboard.scenes).map((item) => Number(item.number) || 0));
const maxClipOrder = Math.max(0, ...Object.values(storyboard.clips).map((item) => Number(item.order) || 0));
const createdAt = new Date().toISOString();

const blocks = blockSpecs.map((block, blockIndex) => {
  const blockShots = shots.filter((shot) => shot.startFrame >= block.startFrame && shot.endFrame <= block.endFrame);
  const clipIds = [];
  for (const [localIndex, shot] of blockShots.entries()) {
    const clipId = `${block.sceneId}-C${String(localIndex + 1).padStart(2, "0")}`;
    const idBase = slug(clipId);
    const frameId = `frame-${idBase}-first`;
    const videoPlanId = `video-${idBase}`;
    const segmentId = `segment-${idBase}-01`;
    const bindingId = `ref-${idBase}-jesus-close-v3`;
    const isOpening = shot.index === 0;
    const expectedInputName = `${clipId}_first.png`;
    const comfyImageFile = isOpening
      ? `Premiere316/${projectSlug}/storyboard/${openingName}`
      : `Premiere316/${projectSlug}/storyboard/${expectedInputName}`;
    const reference = {
      id: bindingId,
      assetId: identityAssetId,
      assetVersion: identityVersion,
      assetVersionId: `${identityAssetId}:v${identityVersion}`,
      sourceAssetFile: identityFile,
      sourceAssetKey: identityFile.replace(/\.[^.]+$/, ""),
      resolutionStatus: "resolved_exact_version",
      role: "identity",
      targetKind: "frame",
      targetId: frameId,
      useMode: "identity_reference",
      required: true,
      order: 1,
      cropRegion: "Face, crown state, hair, beard, shoulders and upper-body build only; never copy a contact-sheet layout.",
      notes: "Exact Jesus close-up v3 is pinned for facial identity. The authored shot prompt remains authoritative for action, crown timing, wounds, wardrobe and composition.",
      pinnedActiveAtImport: Number(identityAsset.activeVersion) === identityVersion
    };
    const frame = {
      id: frameId,
      purpose: "first_frame",
      ownerKind: "clip",
      ownerId: clipId,
      prompt: `PREMIERE316 INTO YOUR HANDS MUSIC VIDEO FIRST FRAME — ${clipId}. ${shot.prompt} Produce one clean photorealistic vertical 9:16 frame at 576x1024 with the global identity, physique, crown-state and historical continuity locks.`,
      negativePrompt: "collage, contact sheet, split panel, captions, typography, watermark, logo, modern object, illustration, plastic skin, duplicate Jesus, extra limb, malformed hands, narrow body, identity drift, incorrect crown state, clean unweathered crucifixion state, excessive graphic detail",
      status: isOpening ? "generated" : "needs_handoff",
      expectedInputPath: comfyImageFile,
      generatedAssetId: isOpening ? frameId : null,
      generatedAssetVersionId: isOpening ? `${frameId}:v1` : null,
      inputHash: isOpening ? openingSha256 : null,
      references: [reference],
      ...(isOpening ? {
        generatedVersions: [{
          v: 1,
          files: [openingName],
          file: openingName,
          mediaType: "image",
          source: "codex_imagegen_portrait_passion_v3",
          workflowId: "openai-imagegen",
          workflowHash: null,
          generationFingerprint: openingSha256,
          prompt: "Approved portrait 9:16 crucifixion cold-open with broad manual-labor physique, unmistakable crown of thorns and stronger non-graphic Passion-film suffering.",
          promptHash: crypto.createHash("sha256").update(shot.prompt).digest("hex"),
          seed: null,
          resolution: { width: 941, height: 1672, ratio: "9:16 source; exact 576x1024 delivery" },
          filenamePrefix: `Premiere316/${projectSlug}/storyboard/MV-Into-Your-Hands-opening`,
          fileHashes: [{ file: openingName, sha256: openingSha256, bytes: openingBytes, extension: ".png" }],
          createdAt
        }],
        activeGeneratedVersion: 1,
        generatedFile: openingName,
        generatedInputPath: `media/storyboard/${openingName}`,
        generationCompletedAt: createdAt,
        generationResolution: { width, height, ratio: "9:16" }
      } : { generatedVersions: [] })
    };
    const audioSegment = {
      id: `audio-${idBase}-master`,
      type: "audio",
      start: 0,
      length: shot.generationFrames,
      trimStart: shot.startFrame,
      audioDurationFrames: totalFrames,
      projectMediaPath: `media/audio/${soundtrackName}`,
      projectMediaBytes: soundtrackBytes,
      projectMediaSha256: soundtrackSha256,
      fileName: soundtrackName,
      prompt: "Immutable original MiniMax Music3 master; one-frame lookahead is conditioning only."
    };
    const timelineSegment = {
      id: segmentId,
      start: 0,
      length: shot.length,
      prompt: shot.prompt,
      type: "image",
      imageFile: comfyImageFile,
      isEndFrame: false,
      guideStrength: 1,
      ...(isOpening ? { projectMediaPath: `media/storyboard/${openingName}` } : { missingGuide: true })
    };
    storyboard.clips[clipId] = {
      id: clipId,
      sceneId: block.sceneId,
      order: maxClipOrder + shot.index + 1,
      timelineStartFrame: baseRuntimeFrames + shot.startFrame,
      durationFrames: shot.length,
      decodedFrames: shot.generationFrames,
      trimDecodedFrames: shot.generationFrames - shot.length,
      beat: shot.lyricCue,
      dialogueAnchor: `Original song lyric cue: ${shot.lyricCue}`,
      shotSizeLens: "Vertical 9:16 cinematic framing; 35 mm language with portrait-safe headroom",
      cameraMovement: "One continuous motivated camera move specified by the local prompt",
      transition: shot.index === shots.length - 1 ? "Fade to black" : "Node 201 boundary-frame handoff to the next shot",
      continuityLocks: [
        "Exact approved Jesus face, hair and beard",
        "Tall broad-shouldered sturdy manual-labor build",
        "Historically correct crown-of-thorns state",
        "True 9:16 portrait composition at 576x1024",
        "Original soundtrack remains unchanged"
      ],
      firstFrameId: frameId,
      videoPlanId,
      renderStatus: "not_started",
      musicVideo: { id: "into-your-hands", shotId: shot.id, songStartFrame: shot.startFrame, songEndFrame: shot.endFrame }
    };
    storyboard.frames[frameId] = frame;
    storyboard.videoPlans[videoPlanId] = {
      id: videoPlanId,
      clipId,
      workflowProfileId: "ltx25-music-video-24gb-distilled-int8",
      globalPrompt,
      guideStrength: "1.00",
      resizeMethod: "crop",
      segmentIds: [segmentId],
      localPrompts: shot.prompt,
      segmentLengths: String(shot.length),
      timelineData: {
        mainTrackEnabled: true,
        audioTrackEnabled: true,
        motionTrackEnabled: false,
        propHeight: 90,
        globalPropHeight: 160,
        showFilenames: true,
        overrideAudio: false,
        inpaint_audio: false,
        global_prompt: globalPrompt,
        retake_global_prompt: "",
        retakeMode: false,
        retakeStart: 0,
        retakeLength: shot.length,
        retakePrompt: "",
        retakeStrength: 1,
        retakeVideo: null,
        normalStartFrame: 0,
        normalDurationFrames: shot.length,
        segments: [timelineSegment],
        motionSegments: [],
        audioSegments: [audioSegment]
      },
      status: isOpening ? "ready" : "needs_frame",
      inputHash: null,
      musicVideo: {
        id: "into-your-hands",
        shotId: shot.id,
        songStartFrame: shot.startFrame,
        requestedFrames: shot.length,
        generationFrames: shot.generationFrames,
        fps,
        width,
        height,
        soundtrack: `media/audio/${soundtrackName}`
      }
    };
    storyboard.segments[segmentId] = {
      id: segmentId,
      videoPlanId,
      order: 1,
      startFrame: 0,
      lengthFrames: shot.length,
      prompt: shot.prompt,
      type: "image",
      isEndFrame: false,
      frameId,
      status: isOpening ? "ready" : "needs_frame"
    };
    storyboard.referenceBindings[bindingId] = reference;
    clipIds.push(clipId);
    shot.clipId = clipId;
    shot.sceneId = block.sceneId;
  }
  storyboard.scenes[block.sceneId] = {
    id: block.sceneId,
    chapterId,
    number: maxSceneNumber + blockIndex + 1,
    title: block.title,
    clipIds
  };
  return {
    id: block.id,
    sceneId: block.sceneId,
    clipId: clipIds[0],
    startFrame: block.startFrame,
    endFrame: block.endFrame,
    title: block.title,
    shots: blockShots.map((shot) => ({
      id: shot.id,
      clipId: shot.clipId,
      startFrame: shot.startFrame,
      length: shot.length,
      generationFrames: shot.generationFrames,
      lyricCue: shot.lyricCue,
      prompt: shot.prompt,
      ...(shot.index === 0 ? {
        guideProjectMediaPath: `media/storyboard/${openingName}`,
        guideProjectMediaBytes: openingBytes,
        guideProjectMediaSha256: openingSha256
      } : {})
    }))
  };
});

storyboard.chapterOrder.push(chapterId);
storyboard.chapters[chapterId] = {
  id: chapterId,
  number: maxChapterNumber + 1,
  title: "Into Your Hands — Portrait Music Video",
  sceneIds: blockSpecs.map((item) => item.sceneId)
};
storyboard.runtimeFrames = baseRuntimeFrames + totalFrames;
storyboard.updatedAt = createdAt;

const manifest = {
  schema: "premiere316.music-video-manifest/v1",
  id: "into-your-hands",
  title: "Into Your Hands — Passion Music Video",
  projectSlug,
  createdAt,
  fps,
  width,
  height,
  aspectRatio: "9:16",
  totalFrames,
  durationSeconds: totalFrames / fps,
  sourceAudioDurationSeconds: 241.870657596,
  globalPrompt,
  soundtrack: {
    title: "Into Your Hands",
    projectMediaPath: `media/audio/${soundtrackName}`,
    workingConditioningPath: `media/audio/${workingAudioName}`,
    bytes: soundtrackBytes,
    sha256: soundtrackSha256,
    sampleRate: 44100,
    channels: 2,
    codec: "flac",
    embeddedMetadata: {
      workflowId: "84709fc6-f3e1-4c97-99ac-75f7f11ed8e0",
      seed: 701168013214206,
      caption: "solo male baritone vocal performance: extreme epic vocal performance exhibiton with multiple crescendos and multiple vocal techinques. soundtrack for passion of christ movie",
      lyricsFile: "lyrics.txt",
      sourceWorkflowFile: "source-workflow.json",
      sourceApiPromptFile: "source-api-prompt.json",
      sourceMetadataFile: "source-audio-metadata.json"
    }
  },
  workflow: {
    profileId: "ltx25-music-video-24gb-distilled-int8",
    modelMode: "distilled-int8-convrot",
    sequential: true,
    node94: "exact editorial MP4",
    node201: "raw 8n+1 boundary-frame handoff",
    delivery: "576x1024 h264 MP4 with original soundtrack remuxed once"
  },
  openingGuide: {
    projectMediaPath: `media/storyboard/${openingName}`,
    bytes: openingBytes,
    sha256: openingSha256,
    sourceWidth: 941,
    sourceHeight: 1672,
    deliveryWidth: width,
    deliveryHeight: height,
    identityAssetId,
    identityAssetVersion: identityVersion,
    description: "Broad, crown-wearing crucifixion cold-open with stronger non-graphic Passion-film suffering."
  },
  blocks
};

const backupDir = path.join(repoRoot, "diagnostics", "workflow-backups");
fs.mkdirSync(backupDir, { recursive: true });
const timestamp = createdAt.replace(/[:.]/g, "-");
const storyboardBackup = path.join(backupDir, `storyboard.before-into-your-hands-${timestamp}.json`);
fs.copyFileSync(storyboardFile, storyboardBackup);
if (fs.existsSync(manifestFile)) {
  fs.copyFileSync(manifestFile, path.join(backupDir, `into-your-hands-manifest.before-${timestamp}.json`));
}

saveStoryboard(projectSlug, storyboard);
atomicWriteJson(manifestFile, manifest);

const saved = loadStoryboard(projectSlug);
const mvClipIds = Object.keys(saved.clips).filter((id) => id.startsWith("MV01-"));
const mvFrameIds = Object.keys(saved.frames).filter((id) => id.startsWith("frame-mv01-"));
const mvPlanIds = Object.keys(saved.videoPlans).filter((id) => id.startsWith("video-mv01-"));
const mvSegmentIds = Object.keys(saved.segments).filter((id) => id.startsWith("segment-mv01-"));
const loadedManifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
if (mvClipIds.length !== 34 || mvFrameIds.length !== 34 || mvPlanIds.length !== 34 || mvSegmentIds.length !== 34) {
  throw new Error(`Saved MV01 counts are invalid: clips=${mvClipIds.length}, frames=${mvFrameIds.length}, plans=${mvPlanIds.length}, segments=${mvSegmentIds.length}`);
}
if (loadedManifest.blocks.flatMap((block) => block.shots).length !== 34 || loadedManifest.totalFrames !== totalFrames) {
  throw new Error("Saved music-video manifest failed the 34-shot/5808-frame contract");
}
if (saved.runtimeFrames !== baseRuntimeFrames + totalFrames) throw new Error("Saved storyboard runtime is invalid");

console.log(JSON.stringify({
  ok: true,
  storyboard: storyboardFile,
  storyboardBackup,
  manifest: manifestFile,
  chapterId,
  scenes: blockSpecs.length,
  clips: mvClipIds.length,
  frames: mvFrameIds.length,
  plans: mvPlanIds.length,
  segments: mvSegmentIds.length,
  baseRuntimeFrames,
  runtimeFrames: saved.runtimeFrames,
  musicVideoFrames: totalFrames,
  durationSeconds: totalFrames / fps,
  fps,
  resolution: `${width}x${height}`,
  openingGuide: `media/storyboard/${openingName}`,
  soundtrack: `media/audio/${soundtrackName}`,
  manifestSha256: sha256File(manifestFile)
}, null, 2));
