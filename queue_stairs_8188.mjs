import { uploadImage, getObjectInfo } from './server/comfy.js';
import { fillI2vPrompt } from './server/timeline.js';

const STILL = 'C:\\Users\\Blokey\\Documents\\Premiere316_AI_Director_Prototype_v2.0.0\\projects\\harrowing_of_hell\\media\\assets\\loc-descent.v1.png';
const PROMPT = 'Cinematic dark-fantasy, Harrowing of Hell look. Camera descends obsidian stone stairs into thick red volumetric haze, dying embers on the walls, smoke and ash, divine gold light fading as we drop, no new characters, no faces added, 9:16 vertical.';

const comfyFile = await uploadImage(STILL, 'harrowing_shorts');
console.log('uploaded', comfyFile);
const compiled = await fillI2vPrompt({
  globalPrompt: PROMPT,
  firstFrameFile: comfyFile,
  durationSec: 16,
  fps: 24,
  width: 704,
  height: 1280,
  filenamePrefix: 'harrowing_shorts/stairs_red_haze',
  ingredients: { enabled: false, modelStrength: 0, guideStrength: 0.75, attentionStrength: 0, maxImages: 0 },
  objectInfo: await getObjectInfo(true)
});
console.log('frames', compiled.requestedFrames, 'gen', compiled.generationFrames, 'warnings', JSON.stringify(compiled.warnings || []));
const r = await fetch('http://127.0.0.1:8188/prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: compiled.prompt, client_id: 'randall-shorts' })
});
const txt = await r.text();
console.log('status', r.status);
console.log(txt.slice(0, 2500));
