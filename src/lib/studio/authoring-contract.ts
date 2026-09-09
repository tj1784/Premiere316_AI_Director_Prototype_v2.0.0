import type { PictureIntake } from "./picture-intake.ts";

/** One department handoff shared by the automatic plan and the screenplay editor. */
export const AUTHORING_WORKFLOW_CONTRACT = `RESEARCH-FIRST AUTHORING AND PRODUCTION
Read the complete intake before making creative decisions. Preserve explicit director instructions and permitted adaptation boundaries.
Complete source and cultural research before drafting the screenplay. Work from the evidence actually supplied or retrieved; never describe model recollection, a search snippet, or an unvisited URL as consulted research. Record locators and distinguish explicit source text, historical evidence, plausible reconstruction, and disputed interpretation. Mark invented dramatic connective material as adaptation, not historical evidence. State remaining uncertainty.
Write the complete screenplay before extracting the production inventory. Review the finished draft in separate source/character and material-culture/continuity critique contexts; correct consequential findings, then review the corrected draft. Respect an explicit user choice to disable automated QA and do not claim that review occurred.
Extract the complete inventory and scene-use links from the final screenplay. Then develop the shared visual direction; then cinematography; then generation prompts; then asset images. Research may identify visual constraints but does not substitute for those later departments.
Asset specifications, research references, draft images and approved canonical images are distinct records. Approve canonical assets before generating first/last frames; approve those frames before generating video. Carry stable identities, state variants and approved reference IDs through every handoff. Never report a specification, prompt or queued job as generated media.`;

export const COMPLETE_SCREENPLAY_CONTRACT = `COMPLETE SCREENPLAY REQUIREMENTS
Produce a complete, playable film, not a treatment, beat summary, montage placeholder, or compressed substitute for the requested duration. Establish relationships through specific behavior; earn reversals through cause and consequence. Let the camera observe: use silence, body language, environmental detail and dialogue subtext. Long holds must contain readable changes in behavior or attention, not merely consume time. Use restrained natural dialogue in the register requested by the intake.
For an adaptation, preserve the source's decisive events, relationships, meaning and deliberate ambiguities. Invent connective scenes and dialogue only within the user's permitted dramatization. Do not equate invented dialogue with Scripture, or turn disputed customs into universal legal consequences. Do not add a resolved ending where the source and intake require an open question.
Use stable numbered Fountain scene headings and an estimated [[Duration: Ns]] note for each scene. Give every scene a dramatic purpose, a change in character or story state, and enough filmable action for its estimated duration. Sum scene durations to the requested runtime; include credits only when requested and account for their time explicitly. These are planning estimates, not a claim of measured finished-film runtime. Preserve supplied scene identifiers and timing when revising or importing.
In a revision, preserve approved character identities, geography, chronology, prop ownership, costume and grooming transitions, and the intake's emotional priorities. A scoped revision changes only the requested scope. Return the requested screenplay format without commentary or a production breakdown.`;

export const ASSET_DEVELOPMENT_CONTRACT = `SCREENPLAY-DERIVED ASSET DEVELOPMENT
Inventory every required visible character, background group, animal, location, wardrobe state, grooming state, prop, food item, set-dressing element, graphic, practical effect and VFX element. Record off-screen voice, sound and music separately; do not generate portraits for sound-only roles. Use only categories supported by the application. Do not truncate the inventory to a fixed number of rows.
Attach each asset to its actual screenplay scene IDs. Deduplicate a shared identity or object across scenes while retaining necessary state variants and scene-specific uses. A dirty, depleted, repaired, aged or restored state belongs to its canonical parent; do not redesign the face, garment construction or object between states. Keep before/after continuity and transitions explicit.
Each specification must describe visible identity, materials and construction, period and regional constraints, condition, continuity locks, required reference views and unresolved research questions. Distinguish a filmed requirement from an optional design reference or non-image deliverable. Extract only supported story elements; camera words are not props and figurative language is not a new visual event.
Visual development uses the completed inventory and research. Cinematography uses that shared visual direction and the screenplay. Prompt development receives all of these, relevant linked scenes, related canonical identities and exact state requirements. Reference packages should suit the asset: identity views, costume construction, prop angles, environment geography or state comparisons.
When developing a new canonical asset, use its unapproved specification and legitimate research references without claiming an approved image exists. For a dependent state, frame or video prompt, reference the approved canonical asset IDs and actual approved media available for that scene. If required references are absent, leave the downstream generation pending. Do not attach arbitrary unrelated assets or silently borrow an unapproved identity.`;

/** Keep complete creative constraints available to every authoring department. */
export function packAuthoringIntake(intake: PictureIntake, includeEvidence = true): string {
  const { createdAt: _createdAt, updatedAt: _updatedAt, screenplayModelId: _model, visualDirection: _visual, ...creative } = intake;
  if (!includeEvidence) {
    return JSON.stringify({ ...creative, sourceMaterial: "[See source evidence packet]", suppliedSourceText: "[See source evidence packet]", existingScreenplay: "[See screenplay packet]",
      importedSources: creative.importedSources.map(({ fileName, mediaType, importedAt }) => ({ fileName, mediaType, importedAt })) }, null, 2);
  }
  return JSON.stringify(creative, null, 2);
}

/** Allow a complete visual script while keeping bounded local-model output. */
export function screenplayOutputBudget(runtimeMinutes: number): number {
  const minutes = Number.isFinite(runtimeMinutes) && runtimeMinutes > 0 ? runtimeMinutes : 30;
  return Math.min(16000, Math.max(4096, Math.ceil(minutes * 500)));
}
