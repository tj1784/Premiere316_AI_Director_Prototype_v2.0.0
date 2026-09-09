import { GLOBAL_PRODUCTION_INSTRUCTIONS } from "./production-instructions.ts";
import { appendScreenplayVersion, type PictureScreenplay, type ScreenplayModelRef } from "./screenplay.ts";
import { spliceScopedFountain, type ScreenplayScope, type ScreenplaySelection } from "./screenplay-scope.ts";
import type { ScreenplayHierarchy } from "./screenplay-hierarchy.ts";

export const SCREENPLAY_QA_CATEGORIES = [
  "SOURCE DRIFT",
  "HISTORICAL DRIFT",
  "CHARACTER DRIFT",
  "SOCIAL-WORLD MISREADING",
  "THEMATIC DRIFT",
  "DIALOGUE ISSUE",
  "PACING ISSUE",
  "CONTINUITY ISSUE",
  "CINEMATOGRAPHY OPPORTUNITY",
] as const;

export type ScreenplayQaCategory = (typeof SCREENPLAY_QA_CATEGORIES)[number];

export type ScreenplayQaFinding = {
  category: ScreenplayQaCategory;
  severity: "note" | "warning" | "blocker";
  summary: string;
  exactScope: string | null;
  recommendation: string | null;
  revisionRequired: boolean;
  rewriteSuggested: string | null;
};

export type ScreenplayQaReport = {
  id: string;
  createdAt: number;
  model: ScreenplayModelRef;
  findings: ScreenplayQaFinding[];
  fountainUnchanged: true;
  role: "qa-critic" | "second-opinion";
};

const LEGACY_CATEGORY: Record<string, ScreenplayQaCategory> = {
  Architecture: "THEMATIC DRIFT",
  Character: "CHARACTER DRIFT",
  "Scene engine": "PACING ISSUE",
  "Cinematic craft": "CINEMATOGRAPHY OPPORTUNITY",
  Dialogue: "DIALOGUE ISSUE",
  "Continuity/runtime": "CONTINUITY ISSUE",
  "Research/fidelity": "SOURCE DRIFT",
  "Social-world cinema": "SOCIAL-WORLD MISREADING",
  "Production playability": "PACING ISSUE",
  "Severity rollup": "THEMATIC DRIFT",
};

function normalizeCategory(value: unknown): ScreenplayQaCategory {
  const raw = String(value ?? "").trim().toUpperCase();
  const match = SCREENPLAY_QA_CATEGORIES.find((item) => item === raw);
  if (match) return match;
  return LEGACY_CATEGORY[String(value ?? "")] ?? "THEMATIC DRIFT";
}

export function parseScreenplayQaReport(
  text: string,
  id: string,
  createdAt: number,
  model: ScreenplayModelRef,
  role: "qa-critic" | "second-opinion" = "qa-critic",
): ScreenplayQaReport | { error: string } {
  try {
    const parsed = JSON.parse(text) as { findings?: Array<Record<string, unknown>> };
    if (!Array.isArray(parsed.findings)) return { error: "Story Doctor returned no findings." };
    return {
      id,
      createdAt,
      model,
      fountainUnchanged: true,
      role,
      findings: parsed.findings.map((finding) => ({
        category: normalizeCategory(finding.category),
        severity: (finding.severity === "blocker" || finding.severity === "warning" ? finding.severity : "note") as ScreenplayQaFinding["severity"],
        summary: String(finding.summary ?? "").trim(),
        exactScope: finding.exactScope ? String(finding.exactScope) : finding.scope ? String(finding.scope) : null,
        recommendation: finding.recommendation ? String(finding.recommendation) : null,
        revisionRequired: Boolean(finding.revisionRequired),
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
  options: { nodeIds?: string[] | null; selection?: ScreenplaySelection; previous?: ScreenplayHierarchy | null } = {},
): PictureScreenplay | { error: string } {
  const finding = report.findings[findingIndex];
  if (!finding?.rewriteSuggested?.trim()) return { error: "This critique has no rewrite to apply." };
  const spliced = spliceScopedFountain(screenplay.workingFountain, scope, nodeId, finding.rewriteSuggested, {
    nodeIds: options.nodeIds,
    selection: options.selection,
    previous: options.previous ?? screenplay.hierarchy,
  });
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
    scope,
    nodeIds: options.nodeIds ?? (nodeId ? [nodeId] : null),
    selection: options.selection ?? null,
    logicalRole: "writer",
  });
}

export const STORY_DOCTOR_SYSTEM = GLOBAL_PRODUCTION_INSTRUCTIONS + `\n\nYou are movie-screenplay-qa, an independent Story Doctor. You do not continue the writer's hidden context. Critique first. Return ONLY JSON {"findings":[{"category":"SOURCE DRIFT|HISTORICAL DRIFT|CHARACTER DRIFT|SOCIAL-WORLD MISREADING|THEMATIC DRIFT|DIALOGUE ISSUE|PACING ISSUE|CONTINUITY ISSUE|CINEMATOGRAPHY OPPORTUNITY","severity":"note|warning|blocker","summary":"...","exactScope":"SCENE-017 or similar","recommendation":"...","revisionRequired":false,"rewriteSuggested":null}]}. Never output Fountain. rewriteSuggested stays null unless a surgical alternative is necessary. Do not mutate the screenplay.`;

export const SECOND_OPINION_SYSTEM = GLOBAL_PRODUCTION_INSTRUCTIONS + `\n\nYou are movie-screenplay-qa-qwen, an optional second-opinion critic. You do not automatically rewrite. Return ONLY the same critique JSON schema as the primary Story Doctor. Never output Fountain.`;
