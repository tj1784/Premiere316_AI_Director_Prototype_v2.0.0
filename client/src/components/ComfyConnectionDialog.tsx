import React, { FormEvent, useEffect, useState } from "react";

type Props = {
  open: boolean;
  initialUrl?: string;
  busy: boolean;
  startingCurrent?: boolean;
  error?: string | null;
  onClose: () => void;
  onConnect: (comfyUrl: string) => Promise<boolean>;
  onStartCurrent?: () => Promise<boolean>;
};

export default function ComfyConnectionDialog({
  open,
  initialUrl,
  busy,
  startingCurrent = false,
  error,
  onClose,
  onConnect,
  onStartCurrent
}: Props) {
  const [comfyUrl, setComfyUrl] = useState(initialUrl || "http://127.0.0.1:8188");

  useEffect(() => {
    if (open) setComfyUrl(initialUrl || "http://127.0.0.1:8188");
  }, [initialUrl, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose, open]);

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (comfyUrl.trim()) await onConnect(comfyUrl.trim());
  };

  return (
    <div
      className="asset-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="asset-editor-dialog comfy-connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="comfy-connection-title"
        aria-describedby="comfy-connection-help"
        onSubmit={submit}
      >
        <header>
          <div>
            <small>Engine connection</small>
            <h2 id="comfy-connection-title">Connect Premiere316 to ComfyUI</h2>
          </div>
          <button className="asset-dialog-close" type="button" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
        </header>
        <div className="asset-dialog-fields">
          <label className="wide" htmlFor="comfy-url">
            <span>ComfyUI IP address and port</span>
            <input
              id="comfy-url"
              value={comfyUrl}
              autoFocus
              autoComplete="url"
              spellCheck={false}
              placeholder="http://127.0.0.1:8188"
              disabled={busy}
              onChange={(event) => setComfyUrl(event.target.value)}
            />
          </label>
          <p id="comfy-connection-help" className="comfy-connection-help">
            Use the address shown in the ComfyUI browser tab. Premiere316 will test it, save it locally, and reconnect on port 8789.
          </p>
          {error ? <p className="comfy-connection-error" role="alert">{error}</p> : null}
        </div>
        <footer>
          <small>The selected address stays fixed across Premiere316 restarts.</small>
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          {onStartCurrent ? (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await onStartCurrent()) onClose();
              }}
            >
              {startingCurrent ? "STARTING…" : "START CURRENT COMFYUI"}
            </button>
          ) : null}
          <button className="button primary" type="submit" disabled={busy || !comfyUrl.trim()}>
            {busy && !startingCurrent ? "CONNECTING…" : "SAVE & CONNECT"}
          </button>
        </footer>
      </form>
    </div>
  );
}
