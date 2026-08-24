import React, { useState } from "react";
import { useStore } from "../store";

export default function ContinuityAction({
  clipId,
  nextClipId
}: {
  clipId: string;
  nextClipId?: string;
}) {
  const store = useStore();
  const projectSlug = store.project?.slug;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const promote = async () => {
    if (!projectSlug || !clipId || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/continuity/promote-last-frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId,
          ...(nextClipId ? { nextClipId } : {})
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Promote last frame failed (${response.status}).`);
      if (store.reloadProject) await store.reloadProject();
      if (store.loadStoryboard) await store.loadStoryboard();
      const next = body.nextClipId || "next shot";
      const count = Array.isArray(body.bindings) ? body.bindings.length : 0;
      setNotice(`Last decoded frame attached as ${next} first guide · ${count} identity/wardrobe binding${count === 1 ? "" : "s"}.`);
    } catch (error: any) {
      setNotice(String(error.message || error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="storyboard-continuity-action">
      <button
        type="button"
        className="secondary-action"
        data-testid="continuity-promote-last-frame"
        disabled={busy || !clipId || !projectSlug}
        onClick={() => void promote()}
      >
        {busy ? "Extracting last frame…" : "Use last frame as next first guide"}
      </button>
      {notice ? <small className="storyboard-global-notice">{notice}</small> : null}
    </div>
  );
}
