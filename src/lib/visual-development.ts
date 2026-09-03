import { stableHash, sourceFingerprint, type SourceFingerprint } from "./production/dependency-graph.ts";
import type { Picture } from "./studio/types.ts";

export type ApprovalState = "DRAFT" | "READY_FOR_REVIEW" | "APPROVED" | "STALE";
export type ReferenceSlot = { id: string; label: string; uri: string; provenance: string; preferred: boolean; createdAt: number };
export type VisualBoard = { id: string; title: string; intent: string; palette: string[]; motifs: string[]; referenceSlots: ReferenceSlot[]; status: ApprovalState; approvedVersionId: string | null };
export type CharacterIdentityBible = { id: string; characterId: string; name: string; invariants: string[]; facialGeometry: string; expressionMatrix: Record<string, string>; posture: string; skinHairBuild: string; wardrobeStateIds: string[]; prohibitedDrift: string[]; referenceSlotIds: string[]; sceneIds: string[]; status: ApprovalState; approvedVersionId: string | null; sourceFingerprints: SourceFingerprint[] };
export type WardrobeStateBible = { id: string; ownerId: string; label: string; era: string; materials: string[]; wearState: string; continuityVariants: string[]; motifLinks: string[]; status: ApprovalState; approvedVersionId: string | null; sourceFingerprints: SourceFingerprint[] };
export type LocationBible = { id: string; locationId: string; name: string; geography: string; era: string; materials: string[]; lightingLogic: string; continuityVariants: string[]; motifLinks: string[]; referenceSlotIds: string[]; status: ApprovalState; approvedVersionId: string | null; sourceFingerprints: SourceFingerprint[] };
export type PropBible = { id: string; propId: string; name: string; materials: string[]; wearState: string; heroDetails: string[]; continuityVariants: string[]; motifLinks: string[]; status: ApprovalState; approvedVersionId: string | null; sourceFingerprints: SourceFingerprint[] };
export type VisualBibleVersion = { id: string; kind: "board" | "character" | "wardrobe" | "location" | "prop"; recordId: string; createdAt: number; sourceVersionId: string | null; hash: string; approved: boolean };
export type DriftCheck = { id: string; severity: "note" | "warning" | "blocker"; recordId: string; message: string; sourceIds: string[] };
export type VisualDevelopmentState = { schemaVersion: 1; boards: VisualBoard[]; characterBibles: CharacterIdentityBible[]; wardrobeStates: WardrobeStateBible[]; locationBibles: LocationBible[]; propBibles: PropBible[]; versions: VisualBibleVersion[]; approvals: VisualBibleVersion[]; driftChecks: DriftCheck[]; updatedAt: number };

export function makeVisualDevelopmentState(now = Date.now()): VisualDevelopmentState {
  return { schemaVersion: 1, boards: [], characterBibles: [], wardrobeStates: [], locationBibles: [], propBibles: [], versions: [], approvals: [], driftChecks: [], updatedAt: now };
}

function fp(kind: SourceFingerprint["sourceKind"], sourceId: string, content: unknown, versionId: string | null = null): SourceFingerprint {
  return sourceFingerprint({ sourceKind: kind, sourceId, versionId, content, approvedAt: null, immutableBoundary: false });
}

export function seedVisualDevelopmentFromPicture(picture: Pick<Picture, "id" | "characters" | "locations" | "wardrobe" | "props" | "scenes" | "tone">, now = Date.now()): VisualDevelopmentState {
  const state = makeVisualDevelopmentState(now);
  state.boards.push({ id: `board:${picture.id}:look`, title: "Picture look bible", intent: picture.tone || "Editorial visual continuity", palette: ["wet charcoal", "warm practical", "salt grey"], motifs: ["faces held past comfort", "practical light islands"], referenceSlots: [], status: "DRAFT", approvedVersionId: null });
  state.characterBibles = picture.characters.map((character) => ({ id: `character-bible:${character.id}`, characterId: character.id, name: character.name, invariants: [character.role, character.arc].filter(Boolean), facialGeometry: character.look, expressionMatrix: { neutral: character.look, pressure: character.arc }, posture: character.role, skinHairBuild: character.look, wardrobeStateIds: picture.wardrobe.filter((item) => item.name.toLocaleLowerCase().includes(character.name.split(" ")[0]?.toLocaleLowerCase() ?? "")).map((item) => `wardrobe-bible:${item.id}`), prohibitedDrift: ["Do not change age, silhouette, or role without approval."], referenceSlotIds: [], sceneIds: picture.scenes.map((scene) => scene.id), status: "DRAFT", approvedVersionId: null, sourceFingerprints: [fp("asset", character.id, character)] }));
  state.wardrobeStates = picture.wardrobe.map((item) => ({ id: `wardrobe-bible:${item.id}`, ownerId: item.id, label: item.name, era: "from intake", materials: [item.description].filter(Boolean), wearState: item.description, continuityVariants: [], motifLinks: [], status: "DRAFT", approvedVersionId: null, sourceFingerprints: [fp("asset", item.id, item)] }));
  state.locationBibles = picture.locations.map((item) => ({ id: `location-bible:${item.id}`, locationId: item.id, name: item.name, geography: item.description, era: "from intake", materials: [item.description].filter(Boolean), lightingLogic: item.lighting ?? "derived from research manifesto", continuityVariants: [], motifLinks: [], referenceSlotIds: [], status: "DRAFT", approvedVersionId: null, sourceFingerprints: [fp("asset", item.id, item)] }));
  state.propBibles = picture.props.map((item) => ({ id: `prop-bible:${item.id}`, propId: item.id, name: item.name, materials: [item.description].filter(Boolean), wearState: item.description, heroDetails: [item.description].filter(Boolean), continuityVariants: [], motifLinks: [], status: "DRAFT", approvedVersionId: null, sourceFingerprints: [fp("asset", item.id, item)] }));
  return { ...state, driftChecks: checkVisualDrift(state), updatedAt: now };
}

export function hydrateVisualDevelopmentState(value: unknown, picture?: Pick<Picture, "id" | "characters" | "locations" | "wardrobe" | "props" | "scenes" | "tone">, now = Date.now()): VisualDevelopmentState {
  if (value && typeof value === "object" && (value as Partial<VisualDevelopmentState>).schemaVersion === 1) {
    const state = value as Partial<VisualDevelopmentState>;
    return { ...makeVisualDevelopmentState(now), ...state, boards: state.boards ?? [], characterBibles: state.characterBibles ?? [], wardrobeStates: state.wardrobeStates ?? [], locationBibles: state.locationBibles ?? [], propBibles: state.propBibles ?? [], versions: state.versions ?? [], approvals: state.approvals ?? [], driftChecks: state.driftChecks ?? [] };
  }
  return picture ? seedVisualDevelopmentFromPicture(picture, now) : makeVisualDevelopmentState(now);
}

export function approveVisualRecord(state: VisualDevelopmentState, kind: VisualBibleVersion["kind"], recordId: string, now = Date.now()): VisualDevelopmentState {
  const record = [...state.boards, ...state.characterBibles, ...state.wardrobeStates, ...state.locationBibles, ...state.propBibles].find((item) => item.id === recordId);
  if (!record) return state;
  const version: VisualBibleVersion = { id: `visual:${kind}:${recordId}:${now}`, kind, recordId, createdAt: now, sourceVersionId: null, hash: stableHash(record), approved: true };
  const mark = <T extends { id: string; status: ApprovalState; approvedVersionId: string | null }>(items: T[]) => items.map((item) => item.id === recordId ? { ...item, status: "APPROVED" as const, approvedVersionId: version.id } : item);
  return { ...state, boards: mark(state.boards), characterBibles: mark(state.characterBibles), wardrobeStates: mark(state.wardrobeStates), locationBibles: mark(state.locationBibles), propBibles: mark(state.propBibles), versions: [...state.versions, version], approvals: [...state.approvals, version], updatedAt: now };
}

export function checkVisualDrift(state: VisualDevelopmentState): DriftCheck[] {
  const checks: DriftCheck[] = [];
  for (const bible of state.characterBibles) {
    if (!bible.invariants.length) checks.push({ id: `drift:${bible.id}:invariants`, severity: "warning", recordId: bible.id, message: "Character identity needs at least one approved invariant before image preparation.", sourceIds: [bible.characterId] });
    if (!bible.prohibitedDrift.length) checks.push({ id: `drift:${bible.id}:prohibited`, severity: "note", recordId: bible.id, message: "Add prohibited-drift rules to protect identity continuity.", sourceIds: [bible.characterId] });
  }
  return checks;
}
