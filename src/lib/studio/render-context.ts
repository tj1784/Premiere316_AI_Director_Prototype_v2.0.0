import type { Picture, Shot } from "./types.ts";
import { stableHash } from "../production/dependency-graph.ts";
import { movieBibleIndex } from "./movie-bible.ts";

export const RENDER_FIELDS = [
  "medium",
  "materials",
  "palette",
  "contrast",
  "optics",
  "acoustics",
  "lighting",
  "weather",
  "music",
] as const;
export type RenderField = (typeof RENDER_FIELDS)[number];
export type RenderClause = {
  id: string;
  field: RenderField;
  value: string;
  scope: "film" | "scene" | "shot";
  scopeId: string;
  sourceId: string;
  sourceRevision: string;
  authority: "user" | "approved-source" | "proposal";
  revision: number;
  deleted?: boolean;
};
export type RenderContext = { schemaVersion: 1; clauses: RenderClause[]; history: RenderClause[] };
function approvedSourceIssue(picture: Picture, clause: Omit<RenderClause, "id" | "revision">) {
  if (clause.authority !== "approved-source") return null;
  const record = movieBibleIndex(picture).find((row) => row.id === clause.sourceId);
  if (
    !record ||
    !/^(approved|canonical)$/i.test(record.status) ||
    record.revision !== clause.sourceRevision
  )
    return `Render source ${clause.sourceId}@${clause.sourceRevision} is missing, changed or not approved. Rebind the actual approved source; a label cannot grant authority.`;
  return null;
}
export function saveRenderClause(
  picture: Picture,
  input: Omit<RenderClause, "id" | "revision">,
): RenderContext {
  const context = picture.renderContext ?? { schemaVersion: 1 as const, clauses: [], history: [] };
  if (!input.sourceId.trim() || !input.sourceRevision.trim())
    throw new Error("Source ID and revision are required.");
  const sourceIssue = approvedSourceIssue(picture, input);
  if (sourceIssue) throw new Error(sourceIssue);
  if (!RENDER_FIELDS.includes(input.field))
    throw new Error(
      "Unsupported shared field; identity, dialogue and event timelines are not global description fields.",
    );
  const valid =
    input.scope === "film"
      ? input.scopeId === picture.id
      : input.scope === "scene"
        ? picture.scenes.some((s) => s.id === input.scopeId)
        : picture.shots.some((s) => s.id === input.scopeId);
  if (!valid) throw new Error("The declared scope does not exist.");
  const previous = context.clauses.find(
    (c) =>
      c.field === input.field &&
      c.scope === input.scope &&
      c.scopeId === input.scopeId &&
      c.authority === input.authority,
  );
  const clause: RenderClause = {
    ...input,
    id: previous?.id ?? `render:${crypto.randomUUID()}`,
    revision: (previous?.revision ?? 0) + 1,
  };
  return {
    ...context,
    clauses: [...context.clauses.filter((c) => c.id !== clause.id), clause],
    history: previous ? [...context.history, previous] : context.history,
  };
}
export function resolveRenderContext(picture: Picture, shot: Pick<Shot, "id" | "sceneId">) {
  const applicable = (picture.renderContext?.clauses ?? []).filter(
    (c) =>
      !c.deleted &&
      ((c.scope === "film" && c.scopeId === picture.id) ||
        (c.scope === "scene" && c.scopeId === shot.sceneId) ||
        (c.scope === "shot" && c.scopeId === shot.id)),
  );
  const scopeOrder = { film: 0, scene: 1, shot: 2 };
  const authorityOrder = { proposal: 0, "approved-source": 1, user: 2 };
  const invalid = new Map(
    applicable.flatMap((clause) => {
      const issue = approvedSourceIssue(picture, clause);
      return issue ? [[clause.id, issue] as const] : [];
    }),
  );
  const effective: RenderClause[] = [],
    withheld: RenderClause[] = [];
  for (const field of RENDER_FIELDS) {
    const candidates = applicable
      .filter((c) => c.field === field)
      .sort(
        (a, b) =>
          authorityOrder[b.authority] - authorityOrder[a.authority] ||
          scopeOrder[b.scope] - scopeOrder[a.scope] ||
          b.revision - a.revision,
      );
    const selected = candidates.find((c) => c.authority !== "proposal" && !invalid.has(c.id));
    if (selected) effective.push(selected);
    withheld.push(...candidates.filter((c) => c !== selected));
  }
  const describe = (clauses: RenderClause[]) =>
    clauses
      .filter((c) => c.value.trim())
      .map((c) => `${c.field}: ${c.value.trim()}`)
      .join("\n");
  return {
    global: describe(effective.filter((c) => c.scope === "film")),
    local: describe(effective.filter((c) => c.scope !== "film")),
    effective,
    withheld,
    issues: [...invalid.values()],
    fingerprint: stableHash(effective),
  };
}
export function renderContextText(picture: Picture, shot: Pick<Shot, "id" | "sceneId">) {
  const resolved = resolveRenderContext(picture, shot);
  if (resolved.issues.length) throw new Error(resolved.issues.join("\n"));
  return [resolved.global, resolved.local].filter(Boolean).join("\n");
}
