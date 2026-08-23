export const WORKFLOW_LIST_STATES = Object.freeze(["idle", "loading", "loaded", "partial", "empty", "error"]);

export function createWorkflowPickerState() {
  return {
    listStatus: "idle",
    selectedKey: "",
    loadingKey: "",
    loadedKey: "",
    loadedHash: "",
    loadedSource: "",
    dirty: false,
    lastError: "",
    requestId: 0,
    sourceErrors: []
  };
}

export function nextRequestId(state) {
  return Number(state?.requestId || 0) + 1;
}

export function isStaleRequest(state, requestId) {
  return Number(requestId) !== Number(state?.requestId || 0);
}

export function announceLoadedAllowed(state, ack = {}) {
  const key = String(ack.workflowKey || ack.id || "");
  if (!key) return false;
  if (!ack.ok) return false;
  if (String(state?.loadingKey || "") !== key) return false;
  if (ack.hash && state.loadedHash && ack.hash !== state.loadedHash && state.loadedKey === key) {
    return true;
  }
  return true;
}

export function loadedLabel(state, workflows = []) {
  if (!state?.loadedKey) return "Not loaded";
  const item = workflows.find((entry) => entry.key === state.loadedKey);
  return item?.label || state.loadedKey;
}

export function graphIdentity(item = {}, graph = null) {
  const id = String(item.id || item.rel || item.key || "");
  const hash = String(item.hash || item.version || digestGraph(graph) || "");
  return {
    workflowKey: String(item.key || id),
    id,
    hash,
    source: String(item.source || "unknown"),
    label: String(item.label || item.name || id)
  };
}

export function digestGraph(graph) {
  if (!graph) return "";
  try {
    const json = typeof graph === "string" ? graph : JSON.stringify(graph);
    let hash = 2166136261;
    for (let index = 0; index < json.length; index += 1) {
      hash ^= json.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  } catch {
    return "";
  }
}

export function mergeWorkflowSources(payloads = []) {
  const items = [];
  const seen = new Set();
  const sourceErrors = [];
  let okSources = 0;
  for (const payload of payloads) {
    if (payload?.error) {
      sourceErrors.push({ source: payload.source, error: payload.error, status: payload.status || 0 });
      continue;
    }
    okSources += 1;
    for (const item of payload.items || []) {
      const key = String(item.key || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  let listStatus = "loaded";
  if (!payloads.length) listStatus = "empty";
  else if (!okSources) listStatus = "error";
  else if (sourceErrors.length) listStatus = items.length ? "partial" : "error";
  else if (!items.length) listStatus = "empty";
  return { items, sourceErrors, listStatus };
}
