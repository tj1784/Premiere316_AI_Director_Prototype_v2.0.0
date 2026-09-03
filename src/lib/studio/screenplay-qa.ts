import { appendScreenplayVersion, type PictureScreenplay, type ScreenplayModelRef } from "./screenplay.ts";
import { spliceScopedFountain, type ScreenplayScope } from "./screenplay-scope.ts";

export type ScreenplayQaCategory =
  | "Architecture"
  | "Character"
  | "Scene engine"
  | "Cinematic craft"
  | "Dialogue"
  | "Continuity/runtime"
  | "Research/fidelity"
  | "Social-world cinema"
  | "Production playability"
  | "Severity rollup";

export type ScreenplayQaFinding = {
  category: ScreenplayQaCategory;
  severity: "note" | "warning" | "blocker";
  summary: string;
  rewriteSuggested: string | null;
};

export type ScreenplayQaReport = {
  id: string;
  createdAt: number;
  model: ScreenplayModelRef;
  findings: ScreenplayQaFinding[];
  fountainUnchanged: true;
};

export function parseScreenplayQaReport(text: string, id: string, createdAt: number, model: ScreenplayModelRef): ScreenplayQaReport | { error: string } {
  try {
    const parsed = JSON.parse(text) as { findings?: ScreenplayQaFinding[] };
    if (!Array.isArray(parsed.findings)) return { error: "Story Doctor returned no findings." };
    return {
      id,
      createdAt,
      model,
      fountainUnchanged: true,
      findings: parsed.findings.map((finding) => ({
        category: finding.category,
        severity: (finding.severity === "blocker" || finding.severity === "warning" ? finding.severity : "note") as ScreenplayQaFinding["severity"],
        summary: String(finding.summary ?? "").trim(),
        rewriteSuggested: finding.rewriteSuggested ? String(finding.rewriteSuggested) : null,
      })).filter((finding) => finding.summary),
    };
  } catch {
    return { error: "Story Doctor output was not valid critique JSON. Fountain was not changed." };
  }
}

export function applyExplicitQaRewrite(
  screenplay: PictureScreenplay,
  report: ScreenplayQaReport,
  findingIndex: number,
  scope: ScreenplayScope,
  nodeId: string | null,
  versionId: string,
  now = Date.now(),
): PictureScreenplay | { error: string } {
  const finding = report.findings[findingIndex];
  if (!finding?.rewriteSuggested?.trim()) return { error: "This critique has no rewrite to apply." };
  const spliced = spliceScopedFountain(screenplay.workingFountain, scope, nodeId, finding.rewriteSuggested);
  return appendScreenplayVersion(screenplay, {
    id: versionId,
    label: `Scoped revision · ${finding.category}`,
    kind: "manual",
    fountain: spliced.fountain,
    createdAt: now,
    model: report.model,
    workflow: screenplay.workflow,
    pass: null,
    sourceVersionId: screenplay.currentVersionId,
    settings: null,
  });
}

export const STORY_DOCTOR_SYSTEM = `You are an independent story doctor. Critique first. Return ONLY JSON {"findings":[{"category":"...","severity":"note|warning|blocker","summary":"...","rewriteSuggested":null}]}. Never output Fountain. rewriteSuggested stays null unless a surgical alternative is necessary. Categories: Architecture, Character, Scene engine, Cinematic craft, Dialogue, Continuity/runtime, Research/fidelity, Social-world cinema, Production playability, Severity rollup.`;
