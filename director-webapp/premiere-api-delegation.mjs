export const DEFAULT_PREMIERE_API_URL = "http://127.0.0.1:8789";

export class PremiereApiError extends Error {
  constructor(message, status = 502, options = {}) {
    super(message, options);
    this.name = "PremiereApiError";
    this.status = status;
  }
}

export function premiereApiBaseUrl(value = process.env.PREMIERE_API_URL) {
  const candidate = String(value || DEFAULT_PREMIERE_API_URL).trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (error) {
    throw new Error(`Invalid PREMIERE_API_URL: ${candidate}`, { cause: error });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Invalid PREMIERE_API_URL protocol: ${parsed.protocol}`);
  }
  return parsed.toString().replace(/\/$/, "");
}

export function semanticT2VDelegationTarget({ mode, workspace, project }) {
  if (mode !== "timeline") return null;
  if (workspace?.premiere?.source !== "storyboard") return null;
  if (String(project?.settings?.videoGenerationMode || "") !== "t2v_with_semantic_references") return null;
  const projectSlug = String(workspace?.premiere?.projectSlug || "");
  const videoPlanId = String(workspace?.premiere?.videoPlanId || "");
  if (!projectSlug || !videoPlanId) return null;
  return { projectSlug, videoPlanId };
}

function errorDetail(body, text, response) {
  if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
  if (typeof body?.error?.message === "string" && body.error.message.trim()) return body.error.message.trim();
  if (text.trim()) return text.trim();
  return `${response.status} ${response.statusText}`.trim();
}

export async function queueSemanticT2VViaPremiere({
  baseUrl = premiereApiBaseUrl(),
  projectSlug,
  videoPlanId,
  fetchImpl = fetch,
  timeoutMs = 60_000
}) {
  const endpoint = new URL(
    `/api/projects/${encodeURIComponent(projectSlug)}/storyboard/video-plans/${encodeURIComponent(videoPlanId)}/generate`,
    `${baseUrl}/`
  ).toString();
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new PremiereApiError(
      timedOut
        ? `Premiere API timed out while queueing ${videoPlanId}`
        : `Premiere API is unavailable at ${baseUrl}: ${String(error?.message || error)}`,
      timedOut ? 504 : 502,
      { cause: error }
    );
  }

  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = null; }
  if (!response.ok) {
    throw new PremiereApiError(errorDetail(body, text, response), response.status);
  }

  const jobId = body?.job?.id;
  if (jobId === undefined || jobId === null || String(jobId).trim() === "") {
    throw new PremiereApiError("Premiere API queued no job: response is missing job.id", 502);
  }
  return { jobId: String(jobId), body, endpoint };
}
