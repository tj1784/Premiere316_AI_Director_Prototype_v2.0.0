import type { Picture } from "./types.ts";
import type { BibleIndexRow } from "./movie-bible.ts";
import { stableHash } from "../production/dependency-graph.ts";

/** Discovery only: never copy or allocate identities in the owning domain stores. */
export function bibleDomainRecords(
  picture: Picture,
): Array<{ row: BibleIndexRow; record: Record<string, unknown> }> {
  const result: Array<{ row: BibleIndexRow; record: Record<string, unknown> }> = [];
  const domains: Array<[unknown, string, BibleIndexRow["kind"]]> = [
    [picture.research, "research", "source"],
    [picture.visualDevelopment, "visual-development", "bible"],
    [picture.cinematography, "cinematography", "camera"],
    [picture.characterVoiceDesigns, "score", "voice"],
    [picture.voices, "score", "voice"],
    [picture.vfx, "inventory", "asset"],
    [picture.generateGates, "generate", "approval"],
    [picture.frameBundle, "generate", "reference"],
    [picture.directorBundle, "generate", "workflow"],
    [picture.directorRenderJobs, "generate", "job"],
    [picture.nativeFilm, "timeline", "timeline"],
    [picture.shotContinuity, "cinematography", "state"],
    [picture.video?.takes.flatMap((take) => take.speechReviews ?? []), "review", "approval"],
    [picture.movieAssemblies, "export", "export"],
    [picture.editorialClipSequences, "export", "timeline"],
    [picture.production, "inventory", "asset"],
    [picture.performance, "performance", "participant"],
    [picture.emotionPerformance, "performance", "participant"],
    [picture.promptLab, "prompts", "prompt"],
    [picture.bibleRun, "screenplay", "run"],
    [picture.bibleRunHistory, "screenplay", "run"],
  ];
  function walk(
    value: unknown,
    locator: string,
    baseKind: BibleIndexRow["kind"],
    path: string,
    parentId: string,
    seen: WeakSet<object>,
  ) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, locator, baseKind, path, parentId, seen));
      return;
    }
    const record = value as Record<string, unknown>;
    const id =
      typeof record.id === "string"
        ? record.id
        : typeof record.canonicalShotId === "string"
          ? record.canonicalShotId
          : baseKind === "job" && typeof record.promptId === "string"
            ? record.promptId
            : null;
    if (id) {
      const kind = /approvals|reviews|decisions|imageInspection/i.test(path)
        ? "approval"
        : /references|referenceSlots|frames/i.test(path)
          ? "reference"
          : /wardrobeStates|appearanceStates/i.test(path)
            ? "state"
            : /findings|driftChecks/i.test(path)
              ? "correction"
              : /sources|evidence/i.test(path)
                ? "source"
                : baseKind;
      const named = [
        record.name,
        record.title,
        record.label,
        record.message,
        record.characterName,
      ].find((v) => typeof v === "string" && v.trim());
      const relations = Object.entries(record).flatMap(([key, val]) => {
        if (/Id$/.test(key) && typeof val === "string" && val !== id)
          return [{ type: key, targetId: val }];
        if (/Ids$/.test(key) && Array.isArray(val))
          return val
            .filter((v): v is string => typeof v === "string")
            .map((targetId) => ({ type: key, targetId }));
        return [];
      });
      result.push({
        record,
        row: {
          id,
          kind,
          ownerId: picture.id,
          name: String(named ?? `${path} · ${id}`),
          status:
            typeof record.status === "string"
              ? record.status
              : record.approved === true
                ? "approved"
                : "recorded; approval not inferred",
          revision: stableHash(record),
          parentId,
          locator,
          relations,
          uri:
            typeof record.mediaUri === "string"
              ? record.mediaUri
              : typeof record.uri === "string"
                ? record.uri
                : undefined,
          hash:
            typeof record.mediaSha256 === "string"
              ? record.mediaSha256
              : typeof record.hash === "string"
                ? record.hash
                : undefined,
          aliases: Array.isArray(record.aliases)
            ? record.aliases.filter((v): v is string => typeof v === "string")
            : undefined,
          tags: Array.isArray(record.tags)
            ? record.tags.filter((v): v is string => typeof v === "string")
            : undefined,
        },
      });
    }
    for (const [key, child] of Object.entries(record)) {
      // Historical snapshots stay inside their immutable owner, not mutable discovery pointers.
      if (/snapshot|fingerprint|payload|compiled|sourcePacket/i.test(key)) continue;
      walk(child, locator, baseKind, key, id ?? parentId, seen);
    }
  }
  for (const [domain, locator, kind] of domains)
    walk(domain, locator, kind, kind, picture.id, new WeakSet());
  return result;
}
