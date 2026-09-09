import { AUTHORING_WORKFLOW_CONTRACT } from "./authoring-contract.ts";

/** Shared generation policy for every picture and every local model. */
export const GLOBAL_PRODUCTION_INSTRUCTIONS = `GLOBAL PRODUCTION RULES
Apply each department's rules only during that department's work. Image reference-sheet layouts and image-token limits are not screenplay instructions.
${AUTHORING_WORKFLOW_CONTRACT}
1. Cohesion is the first priority. Read the picture's intake, explicit director instructions, source material, screenplay, visual development and cinematography together. Preserve the selected era, geography, identities, wardrobe colors and construction, materials, palette and motivated lighting across every department and asset. Never replace an explicit creative choice with a generic default or a critic's preference. Treat a chosen cinematic costume as a design requirement, not an archaeological claim.
2. For a historical or biblical picture, use the period established by its source and instructions. Exclude modern clothing, contemporary festivals, modern architecture, plastics, modern weapons and unrelated fantasy styling unless the user explicitly requests them. State the actual period and relevant construction details in every asset image prompt. Do not infer a modern setting from a short label.
3. Categorize production needs as characters, artifacts/props, wardrobe, locations, vehicles, creatures, visual effects, voice, sound or music. A narrator or off-screen voice is a VOICE asset unless the screenplay explicitly shows that speaker. Do not generate random portraits for voice, sound or music records. Extract assets from linked screenplay scenes and group repeated background extras into coherent representative assets.
4. Every visual asset generation prompt is written by the selected model, is self-contained, and contains at least 1024 actual image-encoder tokens of useful grounded detail. Target 1600–2400 tokens, maximum 3500. A short breakdown description is not a generation prompt. Carry explicit screenplay, cinematography and related-asset continuity into the prompt; do not pad, repeat or invent story events.
5. Every CHARACTER image is a wide photorealistic turnaround reference sheet on a plain neutral grey background, arranged in TWO ROWS. The upper row has FIVE full-body views of the same individual: front, left three-quarter, true side profile, right three-quarter and rear, all head-to-foot at matching scale. A separate lower row has FIVE large head-and-shoulders facial close-ups: front, both three-quarter angles and both profiles. Keep the exact same face, age, hair, build and costume in every view. Use clear soft even light, unobscured facial detail and relaxed poses. Follow the user's supplied turnaround-sheet layout example, not its depicted person's identity, age or costume. Character-sheet presentation replaces scene action and dramatic scenery; preserve the film's identity, costume materials and realistic medium. No four-quadrant collage, fire backdrop, crowd scene or tiny obscured face.
6. Artifacts and props must clearly show period construction, materials and useful angles. Locations must preserve the screenplay's geography, scale, time of day and cinematography. Visible fire sources must produce motivated readable light in scene/location imagery; do not render an unreadably dark night scene beside a bright fire source.
7. Search for and attach relevant real visual references when a costume, artifact or architectural form is difficult to describe. Treat each reference according to its role. Do not mistake a costume reference for an actor identity or rendering-style instruction. Never invent source URLs or claim image conditioning when the chosen renderer accepts text only.
8. Use the selected image model's actual prompt format. KREA2 RAW receives self-contained natural-language text. Use no FLUX-specific syntax, weighted tags, sampler settings, prose citations or visible text overlays in a KREA prompt. Respect explicit user prompt edits; regenerate model-written prompts only when requested.
9. The normal automatic process continues through generated assets. The next required user review is the actual generated assets, followed by generated first/last frames, then generated video clips. Do not describe breakdown rows, prompts, queued jobs or placeholders as completed images.`;

const GLOBAL_KEY = "premiere316-global-production-instructions-v1";
const listeners = new Set<() => void>();
export function getGlobalProductionInstructions(): string {
  try { return globalThis.localStorage?.getItem(GLOBAL_KEY)?.trim() || GLOBAL_PRODUCTION_INSTRUCTIONS; }
  catch { return GLOBAL_PRODUCTION_INSTRUCTIONS; }
}
export function setGlobalProductionInstructions(instructions: string): void {
  globalThis.localStorage?.setItem(GLOBAL_KEY, instructions);
  listeners.forEach((listener) => listener());
}
export function subscribeGlobalProductionInstructions(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const withProductionInstructions = (system: string, instructions = getGlobalProductionInstructions()) => system.includes(instructions) ? system : `${instructions}\n\n${system.replace(GLOBAL_PRODUCTION_INSTRUCTIONS, "").trim()}`;
