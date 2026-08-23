export const TAKE_FILTERS = Object.freeze(["active", "latest", "all"]);
export const DEFAULT_TAKE_FILTER = "active";

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeTakeFilter(value) {
  const next = String(value || "").toLowerCase();
  return TAKE_FILTERS.includes(next) ? next : DEFAULT_TAKE_FILTER;
}

export function takeIsLatestThan(left, right) {
  if (!right) return true;
  if (left?.isLatestTake && !right.isLatestTake) return true;
  if (!left?.isLatestTake && right.isLatestTake) return false;
  const takeDelta = finite(left?.takeNumber) - finite(right?.takeNumber);
  if (takeDelta) return takeDelta > 0;
  return finite(left?.mtimeMs) >= finite(right?.mtimeMs);
}

export function filterTakes(items = [], options = {}) {
  const takeFilter = normalizeTakeFilter(options.takeFilter);
  const selectedSegmentId = String(options.selectedSegmentId || "").trim();
  const sceneFilter = String(options.sceneFilter || "").trim();
  const query = String(options.query || "").trim().toLowerCase();
  const includeUnassigned = Boolean(options.includeUnassigned);
  const filtered = (Array.isArray(items) ? items : []).filter((item) => {
    const itemSeg = String(item?.segmentId || "").trim();
    if (selectedSegmentId) {
      if (itemSeg !== selectedSegmentId && !(includeUnassigned && !itemSeg)) return false;
    }
    if (takeFilter === "active" && !item?.isActiveTake) return false;
    if (sceneFilter && String(item?.sceneId || "") !== sceneFilter) return false;
    if (query && ![
      item?.name, item?.fileName, item?.clipName, item?.sceneTitle, item?.segmentId, item?.prompt
    ].some((value) => String(value || "").toLowerCase().includes(query))) return false;
    return true;
  });

  if (takeFilter !== "latest") {
    return sortTakes(filtered);
  }

  const byKey = new Map();
  for (const item of filtered) {
    const key = selectedSegmentId || String(item.segmentId || item.id);
    const previous = byKey.get(key);
    if (takeIsLatestThan(item, previous)) byKey.set(key, item);
  }
  return sortTakes([...byKey.values()]);
}

export function sortTakes(items = []) {
  return [...items].sort((left, right) =>
    finite(left.editorialIndex, Number.MAX_SAFE_INTEGER) - finite(right.editorialIndex, Number.MAX_SAFE_INTEGER)
    || finite(right.takeNumber) - finite(left.takeNumber)
    || String(left.name || "").localeCompare(String(right.name || ""))
  );
}
