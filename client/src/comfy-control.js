/** @param {{ online?: boolean, busy?: boolean, status?: string }} options */
export function comfyControlLabel({ online, busy = false, status = "idle" } = {}) {
  if (busy) return status === "starting" || !online ? "STARTING COMFYUI…" : "RESTARTING COMFYUI…";
  return online ? "↻ RESTART COMFYUI" : "▶ START COMFYUI";
}

/** @param {{ online?: boolean, managed?: boolean, queueUnsafe?: boolean, endpoint?: string }} options */
export function comfyControlTitle({ online, managed, queueUnsafe, endpoint } = {}) {
  if (!managed) return "Use Settings to configure an externally managed ComfyUI address.";
  if (queueUnsafe) return "Finish or stop every Premiere316 and upstream ComfyUI job before restarting ComfyUI.";
  if (online) return `Safely restart the local ComfyUI at ${endpoint}.`;
  return `Start the local ComfyUI at ${endpoint}.`;
}
