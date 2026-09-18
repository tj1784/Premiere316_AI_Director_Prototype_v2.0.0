/** Deterministic record merge. Absence is never deletion; tombstones are records. */
/** @param {any} value @returns {string} */
export function stableVoiceJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableVoiceJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableVoiceJson(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** @param {any[]} [saved] @param {any[]} [incoming] @param {string} [key] @returns {any[]} */
export function mergeVoiceRecords(saved = [], incoming = [], key = "id") {
  const records = new Map();
  for (const item of [...saved, ...incoming]) {
    if (!item?.[key]) continue;
    const old = records.get(item[key]);
    if (!old) {
      records.set(item[key], item);
      continue;
    }
    const rank = (/** @type {any} */ row) => [
      Number(row.revision ?? 0),
      Number(row.deletedAt != null),
      Number(row.updatedAt ?? row.reviewedAt ?? row.createdAt ?? row.sample?.generatedAt ?? 0),
    ];
    const a = rank(old),
      b = rank(item);
    const delta = b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
    const clean = (/** @type {any} */ row) => {
      const { conflicts, ...rest } = row;
      for (const field of ["audio", "sample"])
        if (rest[field]?.sha256) {
          const { previewUri, mediaUri, ...metadata } = rest[field];
          rest[field] = metadata;
        }
      return rest;
    };
    const same = stableVoiceJson(clean(old)) === stableVoiceJson(clean(item));
    const winner =
      delta > 0 || (delta === 0 && stableVoiceJson(clean(item)) > stableVoiceJson(clean(old)))
        ? item
        : old;
    /** @type {any[]} */
    const conflicts =
      a[0] !== b[0]
        ? (winner.conflicts ?? [])
        : [
            ...(old.conflicts ?? []),
            ...(item.conflicts ?? []),
            ...(!same && a[0] > 0 ? [clean(old), clean(item)] : []),
          ];
    records.set(
      item[key],
      conflicts.length
        ? {
            ...winner,
            conflicts: [...new Map(conflicts.map((c) => [stableVoiceJson(c), c])).values()].sort(
              (x, y) => stableVoiceJson(x).localeCompare(stableVoiceJson(y)),
            ),
          }
        : winner,
    );
  }
  return [...records.values()].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}
/** @param {any} saved @param {any} incoming @returns {any} */
export function mergePictureVoices(saved, incoming) {
  if (!saved) return incoming;
  let base = Number(incoming.updatedAt ?? 0) >= Number(saved.updatedAt ?? 0) ? incoming : saved;
  if (saved.emotionPerformance || incoming.emotionPerformance) {
    const a = saved.emotionPerformance,
      b = incoming.emotionPerformance;
    const drafts = mergeVoiceRecords(a?.drafts, b?.drafts);
    const history = [
      ...new Map(
        [...(a?.history ?? []), ...(b?.history ?? [])].map((event) => [
          stableVoiceJson(event),
          event,
        ]),
      ).values(),
    ].sort((x, y) => x.at - y.at || stableVoiceJson(x).localeCompare(stableVoiceJson(y)));
    /** @type {Record<string,string>} */
    const applied = {};
    for (const event of history) {
      if (event.draftId) applied[event.sceneId] = event.draftId;
      else delete applied[event.sceneId];
    }
    base = { ...base, emotionPerformance: { schemaVersion: 1, drafts, history, applied } };
  }
  const a = saved.characterVoiceDesigns,
    b = incoming.characterVoiceDesigns;
  if (!a && !b) return base;
  const deletedAttachmentIds = [
    ...new Set([...(a?.deletedAttachmentIds ?? []), ...(b?.deletedAttachmentIds ?? [])]),
  ].sort();
  const selections = mergeVoiceRecords(
    Object.entries(a?.selections ?? {}).map(([id, v]) => ({ id, ...v })),
    Object.entries(b?.selections ?? {}).map(([id, v]) => ({ id, ...v })),
  );
  return {
    ...base,
    characterVoiceDesigns: {
      ...a,
      ...b,
      schemaVersion: 1,
      profiles: mergeVoiceRecords(a?.profiles, b?.profiles, "attachmentId").filter(
        (x) => !deletedAttachmentIds.includes(x.attachmentId),
      ),
      iterations: mergeVoiceRecords(a?.iterations, b?.iterations).filter(
        (x) => !deletedAttachmentIds.includes(x.id),
      ),
      selectedByCharacter: { ...a?.selectedByCharacter, ...b?.selectedByCharacter },
      selections: Object.fromEntries(selections.map(({ id, ...v }) => [id, v])),
      deletedAttachmentIds,
    },
  };
}
