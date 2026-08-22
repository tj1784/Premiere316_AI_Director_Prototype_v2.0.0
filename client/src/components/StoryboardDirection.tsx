import React, { useEffect, useState } from "react";
import { assetUrl, useStore } from "../store";
import { openAssetAction } from "../contextual-agency";

export function openLtxDirector(store: any, clipId: string) {
  if (clipId && store?.setSelectedStoryboardClip) store.setSelectedStoryboardClip(clipId);
  const params = new URLSearchParams(window.location.search);
  if (store?.project?.slug) params.set("project", store.project.slug);
  window.history.pushState({}, "", `/direct/ltx${params.size ? `?${params}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function lockList(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function ClipDirectionEditor({ clip, fps }: { clip: any; fps: number }) {
  const store = useStore();
  const [dialogue, setDialogue] = useState(clip.dialogueAnchor || "");
  const [locks, setLocks] = useState((clip.continuityLocks || []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const dirty = dialogue !== String(clip.dialogueAnchor || "") || locks !== (clip.continuityLocks || []).join("\n");

  useEffect(() => {
    setDialogue(clip.dialogueAnchor || "");
    setLocks((clip.continuityLocks || []).join("\n"));
    setNotice("");
  }, [clip.id, clip.dialogueAnchor, (clip.continuityLocks || []).join("\n")]);

  const save = async () => {
    setBusy(true);
    try {
      await store.saveStoryboardDirection({
        clipId: clip.id,
        dialogueAnchor: dialogue,
        continuityLocks: lockList(locks)
      });
      setNotice("Saved clip direction.");
    } catch (error: any) {
      setNotice(String(error.message || error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="storyboard-direction-editor">
      <div className="storyboard-shot-metadata">
        <div><span>Timeline</span><b>{(clip.timelineStartFrame / fps).toFixed(2)}s</b></div>
        <div><span>Duration</span><b>{(clip.durationFrames / fps).toFixed(1)} sec · {clip.durationFrames} frames</b></div>
        <div><span>Shot / lens</span><b>{clip.shotSizeLens}</b></div>
        <div><span>Camera</span><b>{clip.cameraMovement}</b></div>
        <div><span>Transition</span><b>{clip.transition}</b></div>
      </div>
      <label>Dialogue anchor<textarea rows={2} value={dialogue} onChange={(event) => setDialogue(event.target.value)} /></label>
      <label>Continuity locks <small>one per line</small><textarea rows={3} value={locks} onChange={(event) => setLocks(event.target.value)} /></label>
      <footer>
        {dirty ? <em className="unsaved">Unsaved</em> : <em>{notice}</em>}
        <button type="button" className="storyboard-copy-button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save direction"}</button>
        <button type="button" className="storyboard-copy-button" disabled={busy} onClick={() => void store.mutateStoryboardStructure({ action: "add", clipId: clip.id })}>Add segment</button>
        <button type="button" className="storyboard-copy-button" onClick={() => openLtxDirector(store, clip.id)}>Open in LTX Director</button>
      </footer>
    </section>
  );
}

export function SegmentDirectionEditor({
  segment,
  fps,
  clipId,
  clipLabel
}: {
  segment: any;
  fps: number;
  clipId: string;
  clipLabel: string;
}) {
  const store = useStore();
  const [prompt, setPrompt] = useState(segment.prompt || "");
  const [dialogue, setDialogue] = useState(segment.dialogueAnchor || "");
  const [startSec, setStartSec] = useState(((segment.startFrame || 0) / fps).toFixed(1));
  const [durationSec, setDurationSec] = useState(((segment.lengthFrames || 0) / fps).toFixed(1));
  const [locks, setLocks] = useState((segment.continuityLocks || []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [expandedPrompt, setExpandedPrompt] = useState(false);
  const [fullPrompt, setFullPrompt] = useState(false);
  const persistedStart = ((segment.startFrame || 0) / fps).toFixed(1);
  const persistedDuration = ((segment.lengthFrames || 0) / fps).toFixed(1);
  const dirty = prompt !== String(segment.prompt || "")
    || dialogue !== String(segment.dialogueAnchor || "")
    || startSec !== persistedStart
    || durationSec !== persistedDuration
    || locks !== (segment.continuityLocks || []).join("\n");

  useEffect(() => {
    setPrompt(segment.prompt || "");
    setDialogue(segment.dialogueAnchor || "");
    setStartSec(((segment.startFrame || 0) / fps).toFixed(1));
    setDurationSec(((segment.lengthFrames || 0) / fps).toFixed(1));
    setLocks((segment.continuityLocks || []).join("\n"));
    setNotice("");
  }, [segment.id, segment.prompt, segment.dialogueAnchor, segment.startFrame, segment.lengthFrames, (segment.continuityLocks || []).join("\n"), fps]);

  const save = async () => {
    setBusy(true);
    try {
      await store.saveStoryboardDirection({
        clipId,
        segmentId: segment.id,
        prompt,
        dialogueAnchor: dialogue,
        startSec: Number(startSec),
        durationSec: Number(durationSec),
        continuityLocks: lockList(locks)
      });
      setNotice("Saved segment.");
    } catch (error: any) {
      setNotice(String(error.message || error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="storyboard-segment-direction">
      <label>Local prompt
        <button type="button" className="storyboard-copy-button" onClick={() => setExpandedPrompt((current) => !current)}>{expandedPrompt ? "Collapse" : "Expand"}</button>
        <button type="button" className="storyboard-copy-button" onClick={() => setFullPrompt(true)}>Full preview</button>
        <textarea rows={expandedPrompt ? 16 : 5} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <label>Dialogue anchor<input value={dialogue} onChange={(event) => setDialogue(event.target.value)} /></label>
      <div className="storyboard-segment-timing">
        <label>Start (sec)<input type="number" step="0.1" min="0" value={startSec} onChange={(event) => setStartSec(event.target.value)} /></label>
        <label>Duration (sec)<input type="number" step="0.1" min="0.1" value={durationSec} onChange={(event) => setDurationSec(event.target.value)} /></label>
      </div>
      <label>Continuity locks <small>one per line</small><textarea rows={2} value={locks} onChange={(event) => setLocks(event.target.value)} /></label>
      <AudioOffChip segment={segment} clipLabel={clipLabel} clipId={clipId} />
      <footer>
        {dirty ? <em className="unsaved">Unsaved</em> : <em>{notice}</em>}
        <button type="button" className="storyboard-copy-button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save segment"}</button>
        <button type="button" className="storyboard-copy-button" disabled={busy} onClick={() => void store.mutateStoryboardStructure({ action: "duplicate", clipId, segmentId: segment.id })}>Duplicate</button>
        <button type="button" className="storyboard-copy-button" disabled={busy} onClick={() => {
          if (!window.confirm("Delete this segment?")) return;
          void store.mutateStoryboardStructure({ action: "delete", clipId, segmentId: segment.id });
        }}>Delete</button>
        <button type="button" className="storyboard-copy-button" disabled={busy} onClick={() => void store.mutateStoryboardStructure({ action: "move", clipId, segmentId: segment.id, toIndex: Math.max(0, Number(segment.order || 1) - 2) })}>Move up</button>
        <button type="button" className="storyboard-copy-button" disabled={busy} onClick={() => void store.mutateStoryboardStructure({ action: "move", clipId, segmentId: segment.id, toIndex: Number(segment.order || 1) })}>Move down</button>
        <button type="button" className="storyboard-copy-button" onClick={() => openLtxDirector(store, clipId)}>Open in LTX Director</button>
      </footer>
      {fullPrompt ? (
        <div className="storyboard-prompt-fullscreen" role="dialog" aria-modal="true" aria-label="Segment prompt full preview">
          <header>
            <div>
              <p className="eyebrow">SEGMENT PROMPT</p>
              <h2>{clipLabel} · segment {segment.order}</h2>
            </div>
            <div className="requirement-slot-actions">
              <button type="button" className="storyboard-copy-button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save segment"}</button>
              <button type="button" className="storyboard-copy-button" onClick={() => setFullPrompt(false)}>Close</button>
            </div>
          </header>
          <textarea aria-label="Full-screen segment prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </div>
      ) : null}
    </div>
  );
}

export function AudioOffChip({ segment, clipLabel, clipId }: { segment: any; clipLabel: string; clipId?: string }) {
  const store = useStore();
  const [volume, setVolume] = useState(String(segment?.volume ?? 1));
  const [muted, setMuted] = useState(Boolean(segment?.muted));
  if (!segment) return <span>Audio off</span>;

  const cue = String(segment.dialogueAnchor || "").trim();
  const dialogueAsset = (store.project?.assets?.items || []).find((item: any) => item.id === segment.dialogueAssetId);
  const previewFile = dialogueAsset ? (dialogueAsset.file || (dialogueAsset.versions || []).find((version: any) => Number(version.v) === Number(dialogueAsset.activeVersion))?.file) : "";

  const openAudio = (action: "generate" | "upload" | "replace" | "choose" | "attach", relationship = "segment.dialogueAudio", category: "dialogue" | "sound" = "dialogue") => {
    openAssetAction({
      sourceRoute: "/storyboard",
      sourceEntity: { type: "segment", id: segment.id, label: `${clipLabel} · segment ${segment.order}` },
      requirement: { relationship, category, expectedMediaType: "audio" },
      initialAction: action,
      returnFocusId: `audio-${segment.id}`,
      prefill: { name: clipLabel, sampleText: cue, prompt: cue }
    });
  };

  const goCreateSound = () => {
    const params = new URLSearchParams(window.location.search);
    if (store.project?.slug) params.set("project", store.project.slug);
    window.history.pushState({}, "", `/sound${params.size ? `?${params}` : ""}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const saveVolume = (next: string) => {
    setVolume(next);
    if (!clipId) return;
    void store.saveStoryboardDirection({ clipId, segmentId: segment.id, volume: Number(next) });
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (clipId) void store.saveStoryboardDirection({ clipId, segmentId: segment.id, muted: next });
  };

  const removeDialogue = () => {
    if (!clipId) return;
    void store.saveStoryboardDirection({ clipId, segmentId: segment.id, dialogueAssetId: "" });
  };

  return (
    <div className="storyboard-audio-off-panel" aria-label="Segment audio">
      <button type="button" id={`audio-${segment.id}`} className="storyboard-copy-button" onClick={() => openAudio("choose")}>Attach voice take</button>
      <button type="button" className="storyboard-copy-button" onClick={() => openAudio("generate")}>Generate dialogue</button>
      <button type="button" className="storyboard-copy-button" onClick={() => openAudio("upload")}>Upload</button>
      <button type="button" className="storyboard-copy-button" onClick={() => openAudio("replace")}>Replace dialogue</button>
      <button type="button" className="storyboard-copy-button" onClick={() => openAudio("attach", "segment.ambience", "sound")}>Attach ambience/SFX</button>
      <button type="button" className="storyboard-copy-button" onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
      <button type="button" className="storyboard-copy-button" onClick={removeDialogue}>Remove</button>
      {previewFile && store.project?.slug ? <audio className="storyboard-audio-preview" src={assetUrl(store.project.slug, previewFile)} controls preload="none" aria-label="Preview dialogue" /> : <button type="button" className="storyboard-copy-button" disabled={!previewFile}>Preview</button>}
      <label className="storyboard-audio-volume">Volume
        <input type="range" min="0" max="2" step="0.05" value={volume} onChange={(event) => saveVolume(event.target.value)} />
        <span>{Number(volume).toFixed(2)}</span>
      </label>
      <button type="button" className="storyboard-copy-button" onClick={goCreateSound}>Open in Create Sound</button>
      <button type="button" className="storyboard-copy-button" onClick={() => openAudio("attach")}>Attach back</button>
    </div>
  );
}
