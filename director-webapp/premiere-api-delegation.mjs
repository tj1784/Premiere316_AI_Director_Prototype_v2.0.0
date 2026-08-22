export const DEFAULT_PREMIERE_API_URL = "http://127.0.0.1:8789";

export const LTX25_PREMIERE316_PROFILE = Object.freeze({
  id: "LTX2.5_Premiere316",
  generationMode: "i2v_segmented_first_frames",
  lengthModel: "auto_ltx_8n_plus_1",
  semanticConditioning: "ltx-2.5-ingredients-iclora",
  ingredientsAdapter: "LTX\\2.5\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
  semanticRoles: Object.freeze(["identity", "wardrobe", "location", "prop", "crowd", "atmosphere"]),
  maxSemanticReferences: 9
});

export const HARROWING_AAA_I2V_GENERATE_OPTION = Object.freeze({
  id: "harrowing_aaa_i2v_segmented",
  label: "Harrowing of Hell",
  generationMode: LTX25_PREMIERE316_PROFILE.generationMode,
  queueMode: "segments",
  workflowProfileId: LTX25_PREMIERE316_PROFILE.id,
  directorWorkflow: "BlokeyUI/ComfyUI/user/default/workflows/HARROWING OF HELL.json",
  catalogWorkflow: "BlokeyUI/ComfyUI/user/default/workflows/HARROWING OF HELL.json",
  description: "One I2V Comfy job per authored segment. First frame is graph-wired. Ingredients stay IC-LoRA/identity, never extra timeline frames."
});


export const HARROWING_LTX25_DIRECTOR_GENERATE_OPTION = Object.freeze({
  id: "harrowing_of_hell_ltx25_director",
  label: "Harrowing LTX2.5 Director",
  generationMode: LTX25_PREMIERE316_PROFILE.generationMode,
  queueMode: "segments",
  workflowProfileId: LTX25_PREMIERE316_PROFILE.id,
  directorWorkflow: "BlokeyUI/ComfyUI/user/default/workflows/harrowing_of_hell_LTX2.5_Director.json",
  catalogWorkflow: "BlokeyUI/ComfyUI/user/default/workflows/harrowing_of_hell_LTX2.5_Director.json",
  description: "Harrowing of Hell LTX 2.5 Director graph as a first-class LTX Director generate preset."
});
export const PREMIERE_GENERATE_OPTIONS = Object.freeze([
  HARROWING_AAA_I2V_GENERATE_OPTION,
  HARROWING_LTX25_DIRECTOR_GENERATE_OPTION,
  Object.freeze({
    id: "ltx25_premiere316_i2v",
    label: "LTX2.5 Premiere316 I2V · segmented",
    generationMode: LTX25_PREMIERE316_PROFILE.generationMode,
    queueMode: "segments",
    workflowProfileId: LTX25_PREMIERE316_PROFILE.id,
    directorWorkflow: "BlokeyUI/ComfyUI/user/default/workflows/Premiere316/LTX2.5_Premiere316.json",
    catalogWorkflow: "BlokeyUI/ComfyUI/user/default/workflows/Premiere316/LTX2.5_Premiere316.json",
    description: "Compiler-bound Premiere316 subgraph used by LTX Director Queue All."
  }),
  Object.freeze({
    id: "t2v_with_semantic_references",
    label: "Semantic T2V",
    generationMode: "t2v_with_semantic_references",
    queueMode: "timeline",
    workflowProfileId: "ltx-2.5-t2v-semantic-reference-resolver",
    directorWorkflow: null,
    catalogWorkflow: "workflows/storyboard-ltx25-t2v-semantic-reference.ui.json",
    description: "Single semantic T2V timeline job. Music-video clips stay on this path."
  })
]);

export const SEMANTIC_T2V_GENERATION_MODE = "t2v_with_semantic_references";
export const HARROWING_PROJECT_SLUG = "harrowing_of_hell";

export function isSegmentedI2vGenerationMode(generationMode) {
  return String(generationMode || "") === LTX25_PREMIERE316_PROFILE.generationMode;
}

export function semanticT2vLockedForContext({ projectSlug, generationMode } = {}) {
  return String(projectSlug || "") === HARROWING_PROJECT_SLUG
    && isSegmentedI2vGenerationMode(generationMode);
}

export function generateOptionsForContext({ projectSlug, generationMode } = {}) {
  return PREMIERE_GENERATE_OPTIONS.filter((option) => {
    if (option.generationMode !== SEMANTIC_T2V_GENERATION_MODE) return true;
    return !semanticT2vLockedForContext({ projectSlug, generationMode });
  });
}

export function generateOptionForMode(generationMode, selectedId = null, context = {}) {
  const locked = semanticT2vLockedForContext({
    projectSlug: context?.projectSlug,
    generationMode
  });
  if (selectedId) {
    const match = PREMIERE_GENERATE_OPTIONS.find((option) => option.id === selectedId);
    if (match) {
      if (match.generationMode === SEMANTIC_T2V_GENERATION_MODE
        && (locked || isSegmentedI2vGenerationMode(generationMode))) {
        return PREMIERE_GENERATE_OPTIONS.find((option) => option.generationMode === generationMode)
          || HARROWING_AAA_I2V_GENERATE_OPTION;
      }
      return match;
    }
  }
  return PREMIERE_GENERATE_OPTIONS.find((option) => option.generationMode === generationMode)
    || HARROWING_AAA_I2V_GENERATE_OPTION;
}

const SEMANTIC_ROLE_ALIASES = Object.freeze({
  identity: "identity",
  character: "identity",
  face: "identity",
  actor: "identity",
  wardrobe: "wardrobe",
  costume: "wardrobe",
  clothing: "wardrobe",
  location: "location",
  environment: "location",
  set: "location",
  composition: "location",
  prop: "prop",
  artifact: "prop",
  vehicle: "prop",
  crowd: "crowd",
  crowds: "crowd",
  extra: "crowd",
  extras: "crowd",
  creature: "crowd",
  atmosphere: "atmosphere",
  atmosphere_vfx: "atmosphere",
  vfx: "atmosphere",
  lighting: "atmosphere",
  style: "atmosphere"
});

export function canonicalSemanticReferenceRole(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return SEMANTIC_ROLE_ALIASES[normalized] || null;
}

export function premiere316ProfileForWorkspace(workspace) {
  if (workspace?.premiere?.source !== "storyboard") return null;
  if (String(workspace?.premiere?.generationMode || "") !== LTX25_PREMIERE316_PROFILE.generationMode) return null;
  return LTX25_PREMIERE316_PROFILE;
}

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
  const selectedMode = String(
    workspace?.premiere?.generationMode
    || project?.settings?.videoGenerationMode
    || ""
  );
  if (selectedMode !== "t2v_with_semantic_references") return null;
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
