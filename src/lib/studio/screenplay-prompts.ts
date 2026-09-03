import { SOURCE_TYPE_LABELS, sourceTextForIntake, type PictureIntake, type ScreenplayWorkflow } from "./picture-intake.ts";

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
    "You are the screenplay engine inside Premiere316, a professional local movie-production application.",
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

export function buildScreenplayPrompt(input: {
  intake: PictureIntake;
  workflow: ScreenplayWorkflow;
  step: ScreenplayStep;
  previousFountain?: string;
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
    labeled("Dialogue style", intake.dialogueStyle),
    labeled("Supplied story/source", source),
    sourceConstraints(intake),
  ].filter(Boolean).join("\n\n");
  if (step.id === "draft") {
    return {
      system: systemDirection(intake),
      user: `${common}\n\nTASK:\nCreate the first complete screenplay draft. Begin with a Fountain title page, then the screenplay.`,
    };
  }
  return {
    system: systemDirection(intake),
    user: `${common}\n\nCURRENT SCREENPLAY (the sole source version for this pass):\n${previousFountain ?? ""}\n\nPASS ${step.pass} FOCUS:\n${step.focus}\n\nRevise the complete current screenplay in place. Preserve what works, improve only through this pass focus, and return the full updated Fountain screenplay.`,
  };
}

export function normalizeFountainOutput(text: string): string {
  return text
    .trim()
    .replace(/^```(?:fountain|text|plaintext)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}
