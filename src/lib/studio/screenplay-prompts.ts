import { GLOBAL_PRODUCTION_INSTRUCTIONS } from "./production-instructions.ts";
import { visualDirectionText } from "./visual-direction.ts";
import { SOURCE_TYPE_LABELS, sourceTextForIntake, type PictureIntake, type ScreenplayWorkflow } from "./picture-intake.ts";
import type { ResearchContent } from "../research/bible.ts";
import { RESEARCH_CONFIDENCE_LEGEND } from "../research/confidence.ts";

export type ScreenplayStep = {
  id: "draft" | `pass-${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
  label: string;
  pass: number | null;
  focus: string;
};

const GENERAL_FOCUS = [
  "Premise, source, theme, and dramatic architecture",
  "Character, relationships, status, motivations, and arcs",
  "Scene engine, pacing, escalation, and turning points",
  "Cinematic visuals, world, blocking, and recurring motifs",
  "Dialogue, subtext, silence, and distinct character voice",
  "Performance, delivery, sound, and score intentions",
  "Final integration, target runtime, continuity, and screenplay QA",
] as const;

const BIBLICAL_FOCUS = [
  "Canon/source, exegesis, history, and dramatic architecture",
  "Characters, relationships, status, motivations, and arcs",
  "Scriptural/historical scenes, pacing, escalation, and turning points",
  "World, visual language, cultural expectations, social behavior, and motifs",
  "Dialogue, source-language influence, subtext, and distinct character voice",
  "Performance, delivery, sound, and score intentions",
  "Source fidelity, continuity, target runtime, and dramatization QA",
] as const;

export function screenplaySteps(workflow: ScreenplayWorkflow): ScreenplayStep[] {
  const draft: ScreenplayStep = { id: "draft", label: "Draft", pass: null, focus: "Create the first complete cinematic draft" };
  if (workflow === "single") return [draft];
  const focus = workflow === "biblical-7-pass" ? BIBLICAL_FOCUS : GENERAL_FOCUS;
  return [
    draft,
    ...focus.map((item, index) => ({
      id: `pass-${index + 1}` as ScreenplayStep["id"],
      label: `Pass ${index + 1}`,
      pass: index + 1,
      focus: item,
    })),
  ];
}

function labeled(label: string, value: string): string {
  return value.trim() ? `${label}:\n${value.trim()}` : "";
}

function sourceConstraints(intake: PictureIntake): string {
  const blocks = [
    labeled("Adaptation instructions", intake.adaptationInstructions),
    labeled("Material that must be preserved", intake.materialToPreserve),
    labeled("Material that may be dramatized", intake.materialMayDramatize),
    labeled("Fidelity requirements", intake.fidelityRequirements),
    labeled("Historical period", intake.historicalPeriod),
    labeled("Cultural and social world", intake.culturalSocialWorld),
    labeled("Adaptation boundaries", intake.adaptationBoundaries),
    labeled("Story constraints", intake.storyConstraints),
    labeled("Must include", intake.mustInclude),
    labeled("Must avoid", intake.mustAvoid),
  ].filter(Boolean);
  if (intake.sourceType === "biblical-historical" && intake.socialWorld.length) {
    blocks.push(
      `SOCIAL-WORLD EVIDENCE LEDGER:\n${intake.socialWorld.map((entry, index) => [
        `${index + 1}. Expected behavior: ${entry.expectedBehavior}`,
        `Violation / reversal: ${entry.violationOrReversal}`,
        `Who would notice: ${entry.whoWouldNotice}`,
        `Visible reaction: ${entry.visibleReaction}`,
        `Social consequence: ${entry.socialConsequence}`,
        `Historical confidence: ${entry.historicalConfidence}`,
        `Evidence note: ${entry.evidenceNote}`,
      ].join("\n")).join("\n\n")}`,
    );
  }
  return blocks.join("\n\n");
}

function systemDirection(intake: PictureIntake): string {
  const historical = intake.sourceType === "biblical-historical" || intake.workflow === "biblical-7-pass";
  return [
    "You are movie-screenwriter, the principal screenwriter inside Premiere316, a professional local movie-production application.",
    "Return only Fountain-compatible screenplay text. Do not add markdown fences, commentary, a change log, or analysis.",
    "Write a filmable screenplay: visible behavior, playable action, disciplined scene headings, lean description, and character-specific dialogue.",
    `Aim for the requested ${intake.targetRuntimeMinutes}-minute runtime while prioritizing a coherent complete draft within the output limit.`,
    historical
      ? "Maintain an internal evidence distinction: A = explicit source/Scripture, B = strong historical or social evidence, C = reasonable reconstruction, D = disputed tradition or interpretation. Never present C or D as established fact."
      : "Preserve the supplied premise, constraints, and story logic.",
    historical
      ? "Make the modern viewer feel social rules through behavior, reaction, blocking, costume, status, silence, and consequence. Never force characters to explain historical symbolism or announce their own culture for the audience."
      : "Prefer cinematic behavior and subtext over explanatory dialogue.",
  ].join("\n");
}

function packApprovedResearch(research: ResearchContent | null | undefined): string {
  if (!research) return "";
  const sources = research.sources.map((source, index) => [
    `${index + 1}. ${source.title}`,
    `Locator: ${source.locator || "(none)"}`,
    `Confidence: ${source.confidence} · ${RESEARCH_CONFIDENCE_LEGEND[source.confidence]}`,
    source.quote ? `Quote: ${source.quote}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
  const social = research.socialWorldNotes.map((note, index) => [
    `${index + 1}. Expected behavior: ${note.expectedBehavior}`,
    `Cinematic expression — blocking: ${note.cinematicExpression.blocking}`,
    `Costume / status sign: ${note.cinematicExpression.costumeOrStatusSign}`,
    `Silence / withholding: ${note.cinematicExpression.silenceOrWithholding}`,
    `Gaze / spatial honor: ${note.cinematicExpression.gazeOrSpatialHonor}`,
    `Prohibited exposition: ${note.cinematicExpression.prohibitedExposition}`,
    `Confidence: ${note.confidence}`,
  ].join("\n")).join("\n\n");
  const camera = research.cinematographyManifesto;
  return [
    labeled("APPROVED RESEARCH BIBLE (immutable snapshot)", "Do not use later working research notes."),
    labeled("Approved sources / locators / confidence", sources),
    labeled("Approved social-world cinematic expression", social),
    labeled("Approved cinematography research thesis", camera.thesis),
    labeled("Lens language", camera.lensLanguage),
    labeled("Lighting", camera.lighting),
    labeled("Geography", camera.geography),
    labeled("Movement", camera.movement),
    labeled("Texture", camera.texture),
    labeled("Sound world", camera.soundWorld),
    labeled("Music research", camera.musicResearch),
  ].filter(Boolean).join("\n\n");
}

export function buildScreenplayPrompt(input: {
  intake: PictureIntake;
  workflow: ScreenplayWorkflow;
  step: ScreenplayStep;
  previousFountain?: string;
  approvedResearch?: ResearchContent | null;
  scopedPack?: {
    scope: string;
    nodeId: string | null;
    previousSceneSummary?: string;
    nextSceneSummary?: string;
    storyIn?: string;
    storyOut?: string;
    instruction?: string;
    polishOnly?: boolean;
  } | null;
}): { system: string; user: string } {
  const { intake, step, previousFountain } = input;
  const source = sourceTextForIntake(intake);
  const common = [
    `TITLE: ${intake.title.trim()}`,
    `SOURCE MODE: ${SOURCE_TYPE_LABELS[intake.sourceType]}`,
    labeled("Logline", intake.logline || intake.premise),
    labeled("Genre", intake.genre),
    labeled("Tone", intake.tone),
    labeled("Audience / rating", intake.audienceRating),
    labeled("Production style / visual direction", intake.productionStyle),
    labeled("Director notes", intake.directorNotes),
    labeled("Visual direction — design reference only", visualDirectionText(intake.visualDirection)),
    labeled("Dialogue style", intake.dialogueStyle),
    labeled("Supplied story/source", source),
    sourceConstraints(intake),
    packApprovedResearch(input.approvedResearch),
    input.scopedPack ? labeled("Rewrite scope", input.scopedPack.scope) : "",
    input.scopedPack?.nodeId ? labeled("Target node", input.scopedPack.nodeId) : "",
    labeled("Previous scene summary", input.scopedPack?.previousSceneSummary ?? ""),
    labeled("Next scene summary", input.scopedPack?.nextSceneSummary ?? ""),
    labeled("Story state IN", input.scopedPack?.storyIn ?? ""),
    labeled("Story state OUT", input.scopedPack?.storyOut ?? ""),
    labeled("Revision instruction", input.scopedPack?.instruction ?? ""),
  ].filter(Boolean).join("\n\n");
  if (step.id === "draft" && !previousFountain?.trim() && (!input.scopedPack || input.scopedPack.scope === "full")) {
    return {
      system: GLOBAL_PRODUCTION_INSTRUCTIONS + "\n\n" + systemDirection(intake),
      user: `${common}\n\nTASK:\nCreate the first complete screenplay draft. Begin with a Fountain title page, then the screenplay.`,
    };
  }
  const polish = input.scopedPack?.polishOnly ? "Polish language, rhythm, and subtext only. Do not change plot, characters, or scene order." : "";
  const scoped = input.scopedPack && input.scopedPack.scope !== "full";
  return {
    system: GLOBAL_PRODUCTION_INSTRUCTIONS + "\n\n" + systemDirection(intake),
    user: `${common}\n\nCURRENT TARGET (do not regenerate unrelated scenes):\n${previousFountain ?? ""}\n\n${step.pass ? `PASS ${step.pass} FOCUS:\n${step.focus}` : "TASK:\nRevise only the supplied scope. Preserve unrelated IDs and content byte-for-byte."}\n${polish}\n\n${scoped ? "Return ONLY the rewritten scoped Fountain." : "Return the full updated Fountain screenplay."}`,
  };
}

export function buildStoryDoctorUser(input: {
  goal: string;
  approvedResearch?: ResearchContent | null;
  characterState?: string;
  continuityState?: string;
  fountain: string;
  revisionTarget: string;
}): string {
  return [
    labeled("Project goal", input.goal),
    packApprovedResearch(input.approvedResearch),
    labeled("Character state", input.characterState ?? ""),
    labeled("Continuity state", input.continuityState ?? ""),
    labeled("Revision target", input.revisionTarget),
    labeled("Screenplay output to critique", input.fountain),
    "Do not receive or continue writer hidden reasoning. Critique only.",
  ].filter(Boolean).join("\n\n");
}

export function normalizeFountainOutput(text: string): string {
  return text
    .trim()
    .replace(/^```(?:fountain|text|plaintext)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}
