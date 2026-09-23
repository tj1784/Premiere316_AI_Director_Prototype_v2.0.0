import type { Picture } from "./types.ts";
import { stableHash } from "../production/dependency-graph.ts";
import { HARROWING_V3 } from "./creative-preset.ts";
import { bibleDomainRecords } from "./bible-domain-records.ts";
import { importedSourceRecords } from "./imported-source-records.ts";

/** These are extensions of canonical records, keyed by their existing IDs, not copies. */
export const BIBLE_FIELDS = {
  participant: [
    "Incoming situation / known facts",
    "Immediate objective",
    "Partner / obstacle",
    "Concealed versus displayed emotion",
    "Permitted action / speech / sound",
    "Incoming emotional state",
    "Outgoing emotional state",
    "Incoming physical state",
    "Outgoing physical state",
    "Position / support / contact",
    "Trigger / control / response / residue",
  ],
  location: [
    "Source / period / geography",
    "Landmarks / routes / distances / elevation",
    "Entrances / exits / offscreen space",
    "World axes / camera axes",
    "Light / weather variations",
    "Materials / acoustics",
    "Prohibited inventions",
  ],
  prop: [
    "Identity / source",
    "Owner / holder",
    "Incoming condition",
    "Outgoing condition",
    "Use / support / contact",
    "Continuity / prohibited substitution",
  ],
  wardrobe: [
    "Identity / source",
    "Wearer",
    "Material / construction",
    "Incoming dirt / damage",
    "Outgoing dirt / damage",
    "Scene variations / continuity",
  ],
  picture: [
    "Moral question",
    "Treatment",
    "Language",
    "Delivery requirements",
    "Continuity rules",
    "Voice policy",
    "Score policy",
  ],
  character: [
    "Identity / role / established age",
    "Body / visual angles / appearance",
    "Wardrobe / props / habits",
    "History / source boundaries",
    "Beliefs",
    "Want",
    "Need",
    "Mask",
    "Tells",
    "Knowledge boundaries",
    "Relationships / foils",
    "Movement / mobility",
    "Regulation / release / recovery",
    "Voice / language / accent",
    "Authorized speech / sounds",
    "Performance references",
    "Prohibited inventions",
  ],
  scene: [
    "Narrative purpose",
    "Incoming situation",
    "Geography / landmarks / route",
    "Entrances / exits",
    "World positions",
    "Emotional change",
    "Visual / VFX development",
    "Sound development / intentional silence",
    "Musical development",
    "Outgoing continuity",
  ],
  shot: [
    "Complete local video prompt",
    "Starting frame / subject",
    "Camera position / height / axis",
    "Path / timing / focus / endpoint",
    "Coverage purpose",
    "Visibility budget",
    "Contact / support / weight / recipient",
    "Incoming physical state",
    "Outgoing physical state",
    "Completed events",
    "Permitted audio",
    "Editorial timing / clip timing",
  ],
  cue: [
    "Source scene / beat / shot",
    "Narrative function",
    "Sync landmarks / tail",
    "Perspective / distance / motion",
    "Mix priority",
    "Motif pitches / intervals",
    "Rhythm / register / tempo / meter",
    "Instrumentation / development",
    "Entry / exit / vocal policy",
    "Approved reference IDs",
    "Destination / format",
  ],
} as const;
export type BibleKind = keyof typeof BIBLE_FIELDS;
/** Direct intake direction is readable in the Bible without creating an
 * approved or authored Bible revision. A saved Bible edit takes precedence. */
export function pictureBibleFieldView(picture: Picture, field: string) {
  const intake = picture.intake;
  const read = (value: string | undefined) => value?.trim() ?? "";
  let value = "";
  let source = "";
  if (field === BIBLE_FIELDS.picture[0]) {
    value = read(intake.moralQuestion);
    source = "Intake · moral question";
  } else if (field === BIBLE_FIELDS.picture[1]) {
    value = read(intake.treatment);
    source = "Intake · treatment";
  } else if (field === BIBLE_FIELDS.picture[2]) {
    value = read(intake.language);
    source = "Intake · language";
  } else if (field === BIBLE_FIELDS.picture[3]) {
    value = [
      read(intake.deliveryFormat) && `Requested format: ${read(intake.deliveryFormat)}`,
      read(intake.deliveryCodec) && `Requested video codec: ${read(intake.deliveryCodec)}`,
      read(intake.aspectRatio) && `Aspect ratio: ${read(intake.aspectRatio)}`,
      Number.isFinite(intake.frameRate) && intake.frameRate > 0 && `Frame rate: ${intake.frameRate} fps`,
      intake.runtimeSource === "manual" && Number.isFinite(intake.targetRuntimeMinutes) && intake.targetRuntimeMinutes > 0 && `Target runtime: ${intake.targetRuntimeMinutes} minutes`,
    ].filter(Boolean).join("\n");
    source = "Intake · delivery settings";
  } else if (field === BIBLE_FIELDS.picture[4]) {
    value = read(intake.continuityPolicy);
    source = "Intake · continuity policy";
  } else if (field === BIBLE_FIELDS.picture[5]) {
    value = read(intake.voicePolicy);
    source = "Intake · voice policy";
  } else if (field === BIBLE_FIELDS.picture[6]) {
    value = read(intake.scoreStrategy);
    source = "Intake · score strategy";
  }
  return {
    value,
    source: value ? source : "",
    disposition: value ? ("source" as const) : ("missing" as const),
    revision: 0,
  };
}
export type BibleField = {
  value: string;
  disposition: "authored" | "missing" | "not-applicable";
  source: string;
  revision: number;
};
export type BibleExtension = {
  recordId: string;
  kind: BibleKind;
  revision: number;
  fields: Record<string, BibleField>;
};
export type BibleCorrection = {
  id: string;
  recordId: string;
  field: string;
  before: BibleField | null;
  after: BibleField;
  at: number;
};
export type MovieBible = {
  schemaVersion: 1;
  records: Record<string, BibleExtension>;
  corrections: BibleCorrection[];
};
export const emptyMovieBible = (): MovieBible => ({
  schemaVersion: 1,
  records: {},
  corrections: [],
});
export type BibleIndexRow = {
  id: string;
  kind:
    | BibleKind
    | "asset"
    | "reference"
    | "iteration"
    | "script"
    | "beat"
    | "line"
    | "take"
    | "job"
    | "rule"
    | "correction"
    | "prompt"
    | "clip"
    | "workflow"
    | "source"
    | "voice"
    | "state"
    | "camera"
    | "approval"
    | "timeline"
    | "export"
    | "bible"
    | "run";
  ownerId?: string;
  relations?: { type: string; targetId: string }[];
  name: string;
  status: string;
  parentId?: string;
  revision: string;
  locator: string;
  uri?: string;
  hash?: string;
  aliases?: string[];
  tags?: string[];
};

/** Intake files have no stored ID. Derive one from their immutable import metadata,
 * disambiguating repeated filenames imported within the same millisecond. */
function indexedIntakeSources(picture: Picture) {
  const occurrences = new Map<string, number>();
  return (picture.intake.importedSources ?? []).map((source) => {
    const base = `intake-source:${encodeURIComponent(source.fileName)}:${source.importedAt}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return { id: `${base}:${occurrence}`, source };
  });
}

/** Derived discovery view: ownership and approvals remain in their original stores. */
export function movieBibleIndex(picture: Picture): BibleIndexRow[] {
  const rows: BibleIndexRow[] = [
    {
      id: picture.id,
      kind: "picture",
      name: picture.title,
      status: "working",
      revision: String(picture.updatedAt),
      locator: "intake",
    },
  ];
  for (const { id, source } of indexedIntakeSources(picture))
    rows.push({
      id,
      kind: "source",
      name: source.fileName,
      status: "user-supplied file",
      parentId: picture.id,
      revision: stableHash(source),
      locator: "intake",
    });
  for (const source of importedSourceRecords(picture))
    rows.push({
      id: source.id,
      kind: "source",
      name: source.label,
      status: source.href ? "original package file" : "source manifest entry",
      parentId: picture.id,
      revision: source.sha256,
      locator: "screenplay",
      uri: source.href ?? undefined,
      hash: source.sha256,
      aliases: [source.fileName],
    });
  for (const [kind, records, locator] of [
    ["character", picture.characters, "visual-development"],
    ["scene", picture.scenes, "screenplay"],
    ["shot", picture.shots, "shots"],
    ["cue", picture.cues, "score"],
    ["location", picture.locations, "visual-development"],
    ["prop", picture.props, "inventory"],
    ["wardrobe", picture.wardrobe, "inventory"],
  ] as const)
    for (const record of records)
      rows.push({
        id: record.id,
        kind,
        name:
          "name" in record
            ? record.name
            : "slugline" in record
              ? record.slugline
              : record.description,
        status: "authored",
        revision: stableHash(record),
        locator,
      });
  for (const asset of picture.production?.assets ?? []) {
    const kind = (["character", "location", "prop", "wardrobe"] as string[]).includes(
      asset.category,
    )
      ? (asset.category as BibleKind)
      : "asset";
    const existing = rows.findIndex((r) => r.id === asset.id);
    if (existing >= 0) rows.splice(existing, 1);
    rows.push({
      id: asset.id,
      kind,
      name: asset.name,
      status: asset.tombstone
        ? "deleted"
        : asset.approvedIterationId
          ? "approved iteration selected"
          : "review needed",
      revision: stableHash(asset.canonicalSpec),
      locator: "inventory",
      aliases: asset.aliases,
      relations: asset.requiredSceneIds.map((targetId) => ({
        type: "required-in-scene",
        targetId,
      })),
    });
    for (const ref of asset.references)
      rows.push({
        id: ref.id,
        kind: "reference",
        name: ref.name,
        status: "reference",
        parentId: asset.id,
        revision: String(ref.uploadedAt),
        locator: "inventory",
        uri: ref.uri,
      });
    for (const iteration of asset.iterations)
      rows.push({
        id: iteration.id,
        kind: "iteration",
        name: `${asset.name} · ${iteration.id}`,
        status: iteration.status,
        parentId: asset.id,
        revision: iteration.mediaSha256 ?? String(iteration.createdAt),
        locator: "inventory",
        hash: iteration.mediaSha256 ?? undefined,
        uri: iteration.mediaUri ?? undefined,
      });
  }
  for (const cue of picture.audio?.cues ?? [])
    if (!rows.some((r) => r.kind === "cue" && r.id === cue.id))
      rows.push({
        id: cue.id,
        kind: "cue",
        name: cue.name,
        status: cue.kind,
        revision: String(cue.revision ?? 1),
        locator: "score",
      });
  for (const [beatId, participants] of Object.entries(picture.performance?.performance ?? {}))
    for (const [characterId, direction] of Object.entries(participants))
      rows.push({
        id: `performance:${beatId}:${characterId}`,
        kind: "participant",
        name: `${picture.characters.find((c) => c.id === characterId)?.name ?? characterId} · ${picture.performance?.beats.find((b) => b.id === beatId)?.title ?? beatId}`,
        parentId: beatId,
        status: direction.sourceType,
        revision: stableHash(direction),
        locator: "performance",
      });
  for (const version of picture.screenplay.versions)
    rows.push({
      id: version.id,
      kind: "script",
      name: version.label,
      status: version.id === picture.screenplay.approvedVersionId ? "approved" : "draft",
      revision: stableHash(version.fountain),
      locator: "screenplay",
      parentId: picture.id,
    });
  for (const beat of picture.performance?.beats ?? [])
    rows.push({
      id: beat.id,
      kind: "beat",
      name: beat.title,
      status: "authored",
      revision: stableHash(beat),
      locator: "performance",
      parentId: beat.sceneId,
    });
  for (const line of picture.audio?.lines ?? [])
    rows.push({
      id: line.id,
      kind: "line",
      name: line.text,
      status: "authored speech",
      revision: stableHash(line),
      locator: "score",
      parentId: line.sceneId ?? picture.id,
    });
  for (const take of picture.audio?.takes ?? [])
    rows.push({
      id: take.id,
      kind: "take",
      name: take.filename ?? take.id,
      status: take.status,
      revision: String(take.updatedAt),
      locator: "score",
      parentId: take.cueId ?? take.lineId ?? picture.id,
      uri: take.mediaUri ?? undefined,
      hash: take.mediaSha256 ?? undefined,
    });
  for (const job of picture.audio?.jobs ?? [])
    rows.push({
      id: job.id,
      kind: "job",
      name: `Audio ${job.kind}`,
      status: job.status,
      revision: String(job.updatedAt),
      locator: "score",
      parentId: job.cueId ?? job.lineId ?? picture.id,
    });
  for (const clause of picture.renderContext?.clauses ?? [])
    rows.push({
      id: clause.id,
      kind: "rule",
      name: `${clause.scope} ${clause.field}: ${clause.value}`,
      status: clause.authority,
      revision: String(clause.revision),
      locator: "prompts",
      parentId: clause.scopeId,
    });
  for (const correction of picture.movieBible?.corrections ?? [])
    rows.push({
      id: correction.id,
      kind: "correction",
      name: `Correction: ${correction.field}`,
      status: correction.after.disposition,
      revision: String(correction.after.revision),
      locator: "intake",
      parentId: correction.recordId,
    });
  for (const run of [
    ...(picture.bibleRunHistory ?? []),
    ...(picture.bibleRun ? [picture.bibleRun] : []),
  ])
    rows.push({
      id: run.id,
      kind: "run",
      name: `Movie Script ${run.mode}`,
      status: run.status,
      revision: String(run.updatedAt),
      locator: "intake",
      parentId: picture.id,
    });
  for (const job of picture.video?.jobs ?? []) {
    rows.push({
      id: job.id,
      kind: "job",
      name: `Video ${job.kind} · ${job.engineId}`,
      status: job.status,
      revision: String(job.updatedAt),
      parentId: job.shotId,
      locator: "generate",
    });
    const packet = job.promptPackage;
    rows.push({
      id: `prompt:${job.id}`,
      kind: "prompt",
      name: `Submitted prompt · ${job.id}`,
      status: "immutable job snapshot",
      revision: stableHash(packet),
      parentId: job.id,
      locator: "prompts",
      relations: packet.sourcePacket
        ? [{ type: "resolved-reference-packet", targetId: packet.sourcePacket.id }]
        : [],
    });
    if (packet.sourcePacket)
      rows.push({
        id: packet.sourcePacket.id,
        kind: "reference",
        name: `Resolved packet · ${job.shotId}`,
        status: "job-bound snapshot",
        revision: packet.sourcePacket.fingerprint,
        parentId: `prompt:${job.id}`,
        locator: "prompts",
      });
  }
  for (const take of picture.video?.takes ?? [])
    for (const review of take.sourceReviews ?? [])
      rows.push({
        id: review.id,
        kind: "correction",
        name: `Video source review · ${take.shotId}`,
        status: "review recorded",
        revision: review.sourceFingerprint,
        parentId: take.id,
        locator: "review",
        hash: review.mediaSha256,
      });
  for (const take of picture.video?.takes ?? [])
    rows.push({
      id: take.id,
      kind: "take",
      name: take.filename ?? take.id,
      status: take.status,
      revision: String(take.updatedAt),
      parentId: take.jobId,
      locator: "review",
      uri: take.mediaUri ?? undefined,
      hash: take.mediaSha256 ?? undefined,
      relations: [{ type: "shot", targetId: take.shotId }],
    });
  for (const draft of picture.promptLab?.drafts ?? [])
    rows.push({
      id: draft.id,
      kind: "prompt",
      name: `Prompt draft · ${draft.engineId}`,
      status: "draft",
      revision: draft.canonicalSpecHash,
      parentId: picture.id,
      locator: "prompts",
    });
  for (const draft of picture.emotionPerformance?.drafts ?? [])
    rows.push({
      id: draft.id,
      kind: "prompt",
      name: `Performance draft · ${draft.sceneId}`,
      status: picture.emotionPerformance?.applied[draft.sceneId] === draft.id ? "applied" : "draft",
      revision: draft.source,
      parentId: draft.sceneId,
      locator: "performance",
    });
  for (const asset of picture.production?.assets ?? []) {
    for (const version of asset.specVersions ?? [])
      rows.push({
        id: version.id,
        kind: "asset",
        name: `${asset.name} · source specification`,
        status: version.approved ? "approved" : "draft",
        revision: stableHash(version.spec),
        parentId: asset.id,
        locator: "inventory",
      });
    for (const variant of asset.variants)
      rows.push({
        id: variant.id,
        kind: "asset",
        name: `${asset.name} · variant`,
        status: variant.stale ? "stale" : "authored",
        revision: stableHash(variant),
        parentId: asset.id,
        locator: "inventory",
      });
    for (const iteration of asset.iterations)
      for (const review of iteration.reviewDecisions ?? [])
        rows.push({
          id: review.id,
          kind: "correction",
          name: `Media review · ${review.decision}`,
          status: review.decision,
          revision: String(review.at),
          parentId: iteration.id,
          locator: "review",
        });
    for (const event of asset.lineage ?? [])
      rows.push({
        id: event.id,
        kind: "correction",
        name: `${event.type}: ${event.reason}`,
        status: "recorded",
        revision: String(event.at),
        parentId: asset.id,
        locator: "inventory",
        relations: event.sourceAssetIds.map((targetId) => ({ type: "source-asset", targetId })),
      });
  }
  for (const state of Object.values(picture.shotContinuity ?? {}))
    rows.push({
      id: state.id,
      kind: "reference",
      name: `Continuity · ${state.shotId}`,
      status: state.imageDisposition,
      revision: String(state.revision),
      parentId: state.shotId,
      locator: "cinematography",
      hash: state.imageHash || undefined,
    });
  for (const plan of Object.values(picture.directorScenes ?? {})) {
    rows.push({
      id: `workflow:${plan.sceneId}`,
      kind: "workflow",
      name: `Director scene plan · ${plan.sceneId}`,
      status: "authored; requires workflow review",
      revision: stableHash(plan),
      parentId: plan.sceneId,
      locator: "generate",
    });
    for (const segment of plan.segments)
      rows.push({
        id: segment.segmentId,
        kind: "clip",
        name: `${segment.durationFrames} frames · ${segment.type}`,
        status: "planned; not a rendered take",
        revision: stableHash(segment),
        parentId: segment.shotId,
        locator: "generate",
        relations: [{ type: "workflow", targetId: `workflow:${plan.sceneId}` }],
        uri: segment.imageBinding?.mediaUri,
        hash: segment.imageBinding?.sha256,
      });
  }
  for (const { row } of bibleDomainRecords(picture))
    if (!rows.some((r) => r.id === row.id)) rows.push(row);
  return [
    ...new Map(
      rows.map((row) => [`${row.kind}:${row.id}`, { ...row, ownerId: picture.id }]),
    ).values(),
  ];
}

export function editBibleField(
  picture: Picture,
  recordId: string,
  kind: BibleKind,
  field: string,
  value: string,
  source: string,
  disposition: BibleField["disposition"] = "authored",
  now = Date.now(),
): MovieBible {
  if (!movieBibleIndex(picture).some((r) => r.id === recordId && r.kind === kind))
    throw new Error("The source record no longer exists.");
  if (!(BIBLE_FIELDS[kind] as readonly string[]).includes(field))
    throw new Error("Unknown Bible field.");
  if (disposition === "not-applicable" && !value.trim())
    throw new Error("Not applicable requires a scoped reason.");
  const bible = picture.movieBible ?? emptyMovieBible();
  const record = bible.records[recordId] ?? { recordId, kind, revision: 0, fields: {} };
  const before = record.fields[field] ?? null;
  const after: BibleField = {
    value,
    source,
    disposition: value.trim() ? disposition : "missing",
    revision: (before?.revision ?? 0) + 1,
  };
  return {
    ...bible,
    records: {
      ...bible.records,
      [recordId]: {
        ...record,
        revision: record.revision + 1,
        fields: { ...record.fields, [field]: after },
      },
    },
    corrections: [
      ...bible.corrections,
      { id: `correction:${Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, "0")).join("")}`, recordId, field, before, after, at: now },
    ],
  };
}

/** Retrieval follows the owner; snapshots on existing jobs remain immutable after new edits. */
export function resolveBibleRecord(picture: Picture, id: string): unknown {
  if (id === picture.id)
    return {
      id: picture.id,
      title: picture.title,
      intake: picture.intake,
      bible: picture.movieBible?.records[id],
    };
  const imported = indexedIntakeSources(picture).find((item) => item.id === id);
  if (imported) return imported.source;
  const packageSource = importedSourceRecords(picture).find((item) => item.id === id);
  if (packageSource) return packageSource;
  for (const plan of Object.values(picture.directorScenes ?? {})) {
    if (id === `workflow:${plan.sceneId}`) return plan;
    const segment = plan.segments.find((s) => s.segmentId === id);
    if (segment) return segment;
  }
  for (const job of picture.video?.jobs ?? []) {
    if (id === `prompt:${job.id}`) return job.promptPackage;
    if (id === job.promptPackage.sourcePacket?.id) return job.promptPackage.sourcePacket;
  }
  for (const [beatId, participants] of Object.entries(picture.performance?.performance ?? {}))
    for (const [characterId, direction] of Object.entries(participants))
      if (id === `performance:${beatId}:${characterId}`)
        return { beatId, characterId, direction, bible: picture.movieBible?.records[id] };
  const records = [
    ...(picture.production?.assets.filter((a) => !a.tombstone) ?? []),
    ...picture.characters,
    ...picture.locations,
    ...picture.props,
    ...picture.wardrobe,
    ...picture.scenes,
    ...picture.shots,
    ...picture.cues,
    ...picture.screenplay.versions,
    ...(picture.performance?.beats ?? []),
    ...(picture.audio?.cues ?? []),
    ...(picture.audio?.lines ?? []),
    ...(picture.audio?.takes ?? []),
    ...(picture.audio?.jobs ?? []),
    ...(picture.video?.takes ?? []),
    ...(picture.video?.jobs ?? []),
    ...(picture.promptLab?.drafts ?? []),
    ...(picture.emotionPerformance?.drafts ?? []),
    ...(picture.video?.takes.flatMap((take) => take.sourceReviews ?? []) ?? []),
    ...(picture.renderContext?.clauses ?? []),
    ...(picture.movieBible?.corrections ?? []),
    ...Object.values(picture.shotContinuity ?? {}),
    ...(picture.bibleRunHistory ?? []),
    ...(picture.bibleRun ? [picture.bibleRun] : []),
    ...(picture.production?.assets.flatMap((a) => [
      a,
      ...a.references,
      ...a.iterations,
      ...(a.specVersions ?? []),
      ...a.variants,
      ...(a.lineage ?? []),
      ...a.iterations.flatMap((i) => i.reviewDecisions ?? []),
    ]) ?? []),
  ];
  return (
    records.find((record) => record.id === id) ??
    bibleDomainRecords(picture).find((item) => item.row.id === id)?.record ??
    null
  );
}

/** Read the canonical source text and its recorded locator without assigning
 * verification or canon status to an uploaded document. */
export function bibleSourceReading(picture: Picture, row: BibleIndexRow): {
  locator: string;
  text: string;
  label: string;
  importedAt?: number;
} | null {
  if (row.kind !== "source") return null;
  const source = resolveBibleRecord(picture, row.id);
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  const hasQuote = typeof record.quote === "string";
  return {
    locator: typeof record.locator === "string"
      ? record.locator
      : typeof record.fileName === "string" ? record.fileName : "",
    text: hasQuote ? record.quote as string : typeof record.text === "string" ? record.text : "",
    label: hasQuote ? "Source quote / supplied text" : typeof record.packageId === "string" ? "Original package source" : "Imported document",
    ...(typeof record.importedAt === "number" ? { importedAt: record.importedAt } : {}),
  };
}

/** Cross-picture discovery remains a view of canonical owners, never a copied asset store. */
export function searchMovieBibles(pictures: Picture[], query: string, limit = 50) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return pictures
    .flatMap((picture) =>
      movieBibleIndex(picture)
        .filter((row) =>
          `${bibleSearchText(row, picture)} ${picture.title}`.toLowerCase().includes(needle),
        )
        .map((row) => ({ ...row, pictureTitle: picture.title })),
    )
    .slice(0, limit);
}

export function bibleSearchText(row: BibleIndexRow, picture: Picture) {
  const relatedIds = [
    row.parentId,
    ...(row.relations ?? []).map((relation) => relation.targetId),
  ].filter(Boolean);
  const sceneNames = picture.scenes
    .filter((scene) => relatedIds.includes(scene.id))
    .map((scene) => scene.slugline);
  const source = bibleSourceReading(picture, row);
  return [
    row.id,
    row.name,
    row.kind,
    row.status,
    ...(row.aliases ?? []),
    ...(row.tags ?? []),
    ...relatedIds,
    ...sceneNames,
    source?.locator ?? "",
    source?.text ?? "",
  ].join(" ");
}

export function bibleAuthoringContext(picture: Picture, sceneId?: string) {
  const shots = picture.shots.filter((s) => !sceneId || s.sceneId === sceneId);
  const beats = picture.performance?.beats.filter((b) => !sceneId || b.sceneId === sceneId) ?? [];
  const ids = new Set([
    picture.id,
    ...picture.characters.map((c) => c.id),
    ...picture.locations.map((c) => c.id),
    ...picture.props.map((c) => c.id),
    ...picture.wardrobe.map((c) => c.id),
    ...(picture.production?.assets
      .filter(
        (a) =>
          !a.tombstone &&
          (!sceneId || !a.requiredSceneIds.length || a.requiredSceneIds.includes(sceneId)),
      )
      .map((a) => a.id) ?? []),
    ...picture.scenes.filter((s) => !sceneId || s.id === sceneId).map((s) => s.id),
    ...shots.map((s) => s.id),
    ...picture.cues.map((c) => c.id),
    ...(picture.audio?.cues
      .filter((c) => !sceneId || !c.sceneId || c.sceneId === sceneId)
      .map((c) => c.id) ?? []),
  ]);
  for (const beat of beats)
    for (const characterId of Object.keys(picture.performance?.performance[beat.id] ?? {}))
      ids.add(`performance:${beat.id}:${characterId}`);
  return {
    picture: {
      title: picture.title,
      intake: picture.intake,
      format: picture.format,
      fps: picture.fps,
    },
    characters: picture.characters,
    scenes: picture.scenes.filter((s) => !sceneId || s.id === sceneId),
    shots,
    creativePreset: picture.creativePreset === "harrowing-v3" ? HARROWING_V3 : null,
    renderContext: picture.renderContext ?? null,
    shotContinuity: shots.map((s) => picture.shotContinuity?.[s.id]).filter(Boolean),
    screenplay: {
      approvedVersionId: picture.screenplay.approvedVersionId,
      approvedFountain:
        picture.screenplay.versions.find((v) => v.id === picture.screenplay.approvedVersionId)
          ?.fountain ?? null,
      workingFountain: picture.screenplay.workingFountain,
    },
    soundCues:
      picture.audio?.cues.filter((c) => !sceneId || !c.sceneId || c.sceneId === sceneId) ?? [],
    bible: Object.values(picture.movieBible?.records ?? {}).filter((r) => ids.has(r.recordId)),
    assets:
      picture.production?.assets
        .filter((a) => !a.tombstone && (!sceneId || a.requiredSceneIds.includes(sceneId)))
        .map((a) => ({
          id: a.id,
          spec: a.canonicalSpec,
          approvedIterationId: a.approvedIterationId,
        })) ?? [],
    performance: beats.map((beat) => ({
      ...beat,
      participants: picture.performance?.performance[beat.id] ?? {},
    })),
    warning:
      "Source metadata is not proof of viewed media. Missing fields stay missing; proposals cannot change approved identity, exact speech or sound permissions.",
  };
}

/** Excludes generated screenplay text but includes the sources that may make its job obsolete. */
export function screenplaySourceContextFingerprint(picture: Picture) {
  const { screenplay: _screenplay, ...context } = bibleAuthoringContext(picture);
  return stableHash({
    context,
    bindings: picture.productionRouting?.bindings,
    profile: picture.productionRouting?.profileId,
  });
}
