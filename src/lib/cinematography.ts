import { stableHash, sourceFingerprint, type SourceFingerprint } from "./production/dependency-graph.ts";
import type { PictureResearchBible } from "./research/bible.ts";
import type { Picture, Shot } from "./studio/types.ts";
import type { VisualDevelopmentState } from "./visual-development.ts";

export type CinematographyStatus = "DRAFT" | "READY_FOR_REVIEW" | "APPROVED" | "STALE";
export type CinematographyManifestoVersion = { id: string; createdAt: number; thesis: string; hash: string; approved: boolean; sourceFingerprints: SourceFingerprint[] };
export type SequenceVisualArc = { id: string; act: number; label: string; lensLanguage: string; colorContrast: string; movementEvolution: string; geographyRule: string; sourceFingerprints: SourceFingerprint[] };
export type ShotCinematographyPlan = { id: string; shotId: string; sceneId: string; lens: string; framing: string; cameraHeight: string; movement: string; focus: string; lighting: string; texture: string; geography: string; rhythm: string; motif: string; status: CinematographyStatus; approvedVersionId: string | null; sourceFingerprints: SourceFingerprint[] };
export type CinematographyQaFinding = { id: string; severity: "note" | "warning" | "blocker"; category: "REPETITION" | "GEOGRAPHY_DRIFT" | "REDUNDANT_COVERAGE" | "MANIFESTO_DRIFT" | "FOCUS_MONOTONY"; scopeId: string; message: string; recommendation: string };
export type CinematographyQaReport = { id: string; createdAt: number; findings: CinematographyQaFinding[]; planUnchanged: true };
export type CinematographyState = { schemaVersion: 1; manifestoVersions: CinematographyManifestoVersion[]; sequenceArcs: SequenceVisualArc[]; shotPlans: ShotCinematographyPlan[]; qaReports: CinematographyQaReport[]; approvals: { id: string; planId: string; createdAt: number; hash: string }[]; updatedAt: number };

export function makeCinematographyState(now = Date.now()): CinematographyState {
  return { schemaVersion: 1, manifestoVersions: [], sequenceArcs: [], shotPlans: [], qaReports: [], approvals: [], updatedAt: now };
}

function researchText(research?: PictureResearchBible | null): string {
  const manifesto = research?.versions.find((version) => version.id === research.approvedVersionId)?.content.cinematographyManifesto ?? research?.content.cinematographyManifesto;
  return [manifesto?.thesis, manifesto?.lensLanguage, manifesto?.lighting, manifesto?.movement, manifesto?.texture].filter(Boolean).join(" · ");
}

function fp(sourceId: string, content: unknown, versionId: string | null = null): SourceFingerprint {
  return sourceFingerprint({ sourceKind: "cinematography", sourceId, versionId, content, approvedAt: null, immutableBoundary: false });
}

export function seedCinematographyFromPicture(picture: Pick<Picture, "id" | "acts" | "scenes" | "shots" | "research" | "tone">, now = Date.now()): CinematographyState {
  const manifestoText = researchText(picture.research) || picture.tone || "Restrained editorial coverage with motivated movement.";
  const manifesto: CinematographyManifestoVersion = { id: `cine-manifesto:${picture.id}:v1`, createdAt: now, thesis: manifestoText, hash: stableHash(manifestoText), approved: false, sourceFingerprints: [fp(picture.id, manifestoText)] };
  const sequenceArcs = picture.acts.map((act) => ({ id: `sequence-arc:${picture.id}:${act.number}`, act: act.number, label: act.name, lensLanguage: act.number === 1 ? "wider geography before faces" : "longer lenses as pressure rises", colorContrast: "warm practicals against cool negative space", movementEvolution: act.number === 1 ? "static-to-slow-push" : "locked recognition frames", geographyRule: "re-establish screen direction before intimate inserts", sourceFingerprints: [fp(String(act.number), act)] }));
  const shotPlans = picture.shots.map((shot) => planFromShot(shot, now));
  const state = { ...makeCinematographyState(now), manifestoVersions: [manifesto], sequenceArcs, shotPlans, updatedAt: now };
  return { ...state, qaReports: [runCinematographyQa(state, undefined, now)] };
}

function planFromShot(shot: Shot, now: number): ShotCinematographyPlan {
  return { id: `cine-plan:${shot.id}`, shotId: shot.id, sceneId: shot.sceneId, lens: shot.lens || "35mm", framing: `${shot.type} · ${shot.camera}`, cameraHeight: shot.type === "insert" ? "table height" : "eye line", movement: shot.cameraMove || "motivated static", focus: shot.type === "closeup" ? "sharp eyes, mouth and facial texture; enough depth of field for the performance" : "geography readable; visible speaking faces use a close-up unless the shot records an artistic exception", lighting: "motivated by approved research manifesto", texture: "35mm grain / production texture", geography: "preserve scene screen direction", rhythm: `${shot.durationSec}s ${shot.type}`, motif: shot.emotion || "continuity", status: "DRAFT", approvedVersionId: null, sourceFingerprints: [fp(shot.id, shot, null)] };
}

export function hydrateCinematographyState(value: unknown, picture?: Pick<Picture, "id" | "acts" | "scenes" | "shots" | "research" | "tone">, now = Date.now()): CinematographyState {
  if (value && typeof value === "object" && (value as Partial<CinematographyState>).schemaVersion === 1) {
    const state = value as Partial<CinematographyState>;
    return { ...makeCinematographyState(now), ...state, manifestoVersions: state.manifestoVersions ?? [], sequenceArcs: state.sequenceArcs ?? [], shotPlans: state.shotPlans ?? [], qaReports: state.qaReports ?? [], approvals: state.approvals ?? [] };
  }
  return picture ? seedCinematographyFromPicture(picture, now) : makeCinematographyState(now);
}

export function cinematographyApprovalBlockers(state: CinematographyState, planId: string): CinematographyQaFinding[] {
  const plan = state.shotPlans.find((item) => item.id === planId);
  if (!plan) return [];
  const latest = state.qaReports.at(-1) ?? runCinematographyQa(state);
  return latest.findings.filter((finding) => finding.severity === "blocker" && (finding.scopeId === plan.id || finding.scopeId === plan.sceneId || finding.scopeId === plan.shotId));
}

export function approveCinematographyPlan(state: CinematographyState, planId: string, now = Date.now()): CinematographyState {
  const plan = state.shotPlans.find((item) => item.id === planId);
  if (!plan || cinematographyApprovalBlockers(state, planId).length) return state;
  const approval = { id: `cine-approval:${planId}:${now}`, planId, createdAt: now, hash: stableHash(plan) };
  return { ...state, shotPlans: state.shotPlans.map((item) => item.id === planId ? { ...item, status: "APPROVED", approvedVersionId: approval.id } : item), approvals: [...state.approvals, approval], updatedAt: now };
}

export function runCinematographyQa(state: CinematographyState, visual?: VisualDevelopmentState, now = Date.now()): CinematographyQaReport {
  const findings: CinematographyQaFinding[] = [];
  const byScene = new Map<string, ShotCinematographyPlan[]>();
  for (const plan of state.shotPlans) byScene.set(plan.sceneId, [...(byScene.get(plan.sceneId) ?? []), plan]);
  for (const [sceneId, plans] of byScene) {
    const closeups = plans.filter((plan) => /close|portrait/i.test(`${plan.framing} ${plan.lens}`));
    if (closeups.length > Math.max(2, plans.length - 1)) findings.push({ id: `cineqa:${sceneId}:closeups`, severity: "warning", category: "REPETITION", scopeId: sceneId, message: "Coverage leans on repeated close/portrait framing.", recommendation: "Preserve close-ups for speaking faces; add geography, inserts, or motivated negative-space coverage between dialogue beats." });
    const moves = new Set(plans.map((plan) => plan.movement.toLocaleLowerCase()));
    if (plans.length > 2 && moves.size === 1) findings.push({ id: `cineqa:${sceneId}:movement`, severity: "note", category: "FOCUS_MONOTONY", scopeId: sceneId, message: "Movement/focus pattern is monotonous across the scene.", recommendation: "Vary movement only where story pressure changes." });
    if (plans.some((plan) => !/geograph|screen direction|establish/i.test(plan.geography))) findings.push({ id: `cineqa:${sceneId}:geography`, severity: "blocker", category: "GEOGRAPHY_DRIFT", scopeId: sceneId, message: "A shot lacks explicit geography or screen-direction continuity.", recommendation: "State geography continuity before approval." });
  }
  const manifesto = state.manifestoVersions[0]?.thesis ?? "";
  for (const plan of state.shotPlans) {
    if (manifesto && !`${plan.lighting} ${plan.texture} ${plan.motif}`.toLocaleLowerCase().includes(manifesto.split(/\s+/)[0]?.toLocaleLowerCase() ?? "")) findings.push({ id: `cineqa:${plan.id}:manifesto`, severity: "note", category: "MANIFESTO_DRIFT", scopeId: plan.id, message: "Plan should make its relationship to the manifesto explicit.", recommendation: "Tie lighting, texture, or motif back to the approved manifesto." });
  }
  if (visual && !visual.approvals.length) findings.push({ id: "cineqa:visual-bible", severity: "warning", category: "MANIFESTO_DRIFT", scopeId: "visual-development", message: "No approved visual bible is available for camera continuity checks.", recommendation: "Approve at least one Visual Development bible before final preparation." });
  return { id: `cineqa:${stableHash(findings.map((finding) => ({ category: finding.category, scopeId: finding.scopeId, severity: finding.severity, message: finding.message })))}`, createdAt: now, findings, planUnchanged: true };
}
