/** Explicit picture scope only. Never infer religious constraints from a title. */
export const HARROWING_V3 = {
  id: "harrowing-v3",
  sourcePolicy:
    "Classify every source claim as source-supported, later tradition, or cinematic synthesis. Do not conflate them.",
  chronology: [
    "Descent",
    "Break the gates from outside",
    "Entry",
    "Prison systems fail",
    "Optional already-bound Watchers",
    "Return to the captives",
    "Adam and Eve rescued",
    "Exodus",
  ],
  boundaries:
    "Optional resurrection is a separate sequence. No Final Judgment or Ascension. Broken gates, released chains and other completed events remain completed.",
  identity:
    "Preserve approved Jesus identity, wounds and linen; no crown. Do not invent approved identity when its reference is missing.",
  visualArc:
    "Slate into black/silver into gold; motivated change, not a filter pasted onto every scene.",
  speech:
    "Aim for 0–2% spoken runtime with a hard 5% ceiling. Silence is deliberate; emotion cannot authorize speech or vocalizations.",
  music:
    "Original score with wordless choir only where permitted. Specify the actual three-note motif pitches, rhythm, register and development or mark the reference missing; never pretend a label is a musical specification.",
} as const;
export function dialogueBudget(spokenSeconds: number, totalSeconds: number) {
  if (
    !Number.isFinite(spokenSeconds) ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds <= 0 ||
    spokenSeconds < 0 ||
    spokenSeconds > totalSeconds
  )
    throw new Error("Valid measured spoken and total runtime are required.");
  const ratio = spokenSeconds / totalSeconds;
  return { ratio, withinTarget: ratio <= 0.02, withinCeiling: ratio <= 0.05 };
}
