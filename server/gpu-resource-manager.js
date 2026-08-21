const VALID_OWNERS = new Set(["comfyui", "index-tts", "qwen-voice-design", "qwen-tts"]);

let lease = null;

function normalizedOwner(value) {
  const owner = String(value || "").trim().toLowerCase();
  if (!VALID_OWNERS.has(owner)) throw new Error(`Unknown GPU lease owner: ${value || "missing"}`);
  return owner;
}

function publicLease() {
  return lease ? { ...lease } : null;
}

export function acquireGpuLease(ownerValue, options = {}) {
  const owner = normalizedOwner(ownerValue);
  if (lease && lease.owner !== owner) {
    const error = new Error(`GPU is reserved by ${lease.label || lease.owner}`);
    error.code = "GPU_LEASE_BUSY";
    error.statusCode = 409;
    error.lease = publicLease();
    throw error;
  }
  const now = new Date().toISOString();
  lease = {
    owner,
    label: String(options.label || lease?.label || owner),
    jobId: options.jobId || lease?.jobId || null,
    workerPid: options.workerPid || lease?.workerPid || null,
    state: String(options.state || lease?.state || "reserved"),
    acquiredAt: lease?.acquiredAt || now,
    updatedAt: now
  };
  return publicLease();
}

export function updateGpuLease(ownerValue, patch = {}) {
  const owner = normalizedOwner(ownerValue);
  if (!lease || lease.owner !== owner) return acquireGpuLease(owner, patch);
  lease = {
    ...lease,
    ...patch,
    owner,
    label: String(patch.label || lease.label || owner),
    updatedAt: new Date().toISOString()
  };
  return publicLease();
}

export function releaseGpuLease(ownerValue, options = {}) {
  const owner = normalizedOwner(ownerValue);
  if (!lease) return true;
  if (lease.owner !== owner && options.force !== true) return false;
  lease = null;
  return true;
}

export function gpuLeaseStatus() {
  return publicLease();
}

export function resetGpuLeaseForTests() {
  lease = null;
}

export const GPU_RESOURCE_OWNERS = Object.freeze({
  COMFYUI: "comfyui",
  INDEX_TTS: "index-tts",
  QWEN_VOICE_DESIGN: "qwen-voice-design",
  QWEN_TTS: "qwen-tts"
});
