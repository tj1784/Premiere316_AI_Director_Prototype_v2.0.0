export function segmentTakes(segment) {
  return Array.isArray(segment?.generatedTakes) ? segment.generatedTakes.filter(Boolean) : [];
}

export function activeTakeOf(segment) {
  const takes = segmentTakes(segment);
  return takes.find((take) => String(take.id) === String(segment?.activeTakeId))
    || takes.find((take) => Number(take.v) === Number(segment?.activeGeneratedVersion))
    || takes.find((take) => take.previewFile || take.file || take.generatedInputPath)
    || takes[0]
    || null;
}

export function takePreviewUrl(projectSlug, take) {
  const file = take?.previewFile || take?.file || take?.generatedInputPath || "";
  return projectSlug && file
    ? `/api/premiere/media/${encodeURIComponent(projectSlug)}?file=${encodeURIComponent(file)}`
    : "";
}

export function previewPlaylist(workspace, projectSlug) {
  return (workspace?.timeline?.segments || [])
    .filter((segment) => [undefined, "image", "video"].includes(segment?.type) && (Number(segment.length) || 0) > 0)
    .slice()
    .sort((left, right) => (Number(left.start) || 0) - (Number(right.start) || 0))
    .map((segment) => {
      const take = activeTakeOf(segment);
      return {
        segmentId: segment.id,
        fileName: segment.fileName || segment.id,
        start: Number(segment.start) || 0,
        length: Math.max(1, Number(segment.length) || 1),
        take,
        url: take ? takePreviewUrl(projectSlug, take) : ""
      };
    });
}

export function firstPlayablePreviewIndex(playlist) {
  const index = (playlist || []).findIndex((item) => item?.url);
  return index >= 0 ? index : 0;
}

export function libraryCardMarkup(take, active, previewUrl) {
  const id = String(take?.id || (take?.v != null ? `v${take.v}` : "take"));
  const stamp = take?.createdAt ? ` · ${take.createdAt}` : "";
  return `<button type="button" class="library-card${active ? " active" : ""}" data-activate-take="${escapeAttr(id)}">
    <div class="library-thumb">${previewUrl ? `<video src="${escapeAttr(previewUrl)}" muted playsinline preload="metadata"></video>` : "<span aria-hidden=\"true\">◇</span>"}</div>
    <strong>${escapeAttr(id)}</strong>
    <small>${active ? "ACTIVE" : "Click to activate"}${escapeAttr(stamp)}</small>
  </button>`;
}

function escapeAttr(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
