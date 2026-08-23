from pathlib import Path
p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\client\src\components\LtxDirectorWorkspace.tsx")
text = p.read_text(encoding="utf-8")
text = text.replace(
    "import React, { useCallback, useEffect, useMemo, useState } from \"react\";",
    "import React, { useCallback, useEffect, useMemo, useRef, useState } from \"react\";"
)

player = '''
function AssembledPreviewPlayer({
  playlist,
  fps,
  playheadFrame,
  playing,
  previewIndex,
  onPlayhead,
  onPlayingChange,
  onPreviewIndex,
  onSelectSegment
}: {
  playlist: any[];
  fps: number;
  playheadFrame: number;
  playing: boolean;
  previewIndex: number;
  onPlayhead: (frame: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onPreviewIndex: (index: number) => void;
  onSelectSegment: (segmentId: string, frame: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playable = playlist.map((item, index) => ({ ...item, index })).filter((item) => item.url);
  const current = playlist[previewIndex] || playable[0] || null;
  const currentPlayableIndex = playable.findIndex((item) => item.segmentId === current?.segmentId);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current?.url) return;
    if (playing) {
      void video.play().catch(() => onPlayingChange(false));
    } else {
      video.pause();
    }
  }, [playing, current?.url, previewIndex]);

  const seekFromPlayhead = () => {
    const video = videoRef.current;
    if (!video || !current) return;
    const offset = Math.max(0, (Number(playheadFrame) || 0) - (Number(current.start) || 0));
    const seconds = offset / Math.max(1, fps);
    if (Math.abs((video.currentTime || 0) - seconds) > 0.2) video.currentTime = seconds;
  };

  useEffect(() => {
    if (!playing) seekFromPlayhead();
  }, [playheadFrame, previewIndex, playing]);

  const advance = () => {
    const next = playable[currentPlayableIndex + 1];
    if (!next) {
      onPlayingChange(false);
      return;
    }
    onPreviewIndex(next.index);
    onPlayhead(next.start);
    onSelectSegment(next.segmentId, next.start);
  };

  if (!playlist.length) {
    return <div className="ltx-preview-player empty"><p>No authored segments to preview.</p></div>;
  }

  return (
    <div className="ltx-preview-player">
      <div className="ltx-preview-stage">
        {current?.url ? (
          <video
            ref={videoRef}
            key={current.url}
            src={current.url}
            playsInline
            controls={false}
            onTimeUpdate={(event) => {
              const frame = (Number(current.start) || 0) + Math.round((event.currentTarget.currentTime || 0) * fps);
              onPlayhead(Math.min((Number(current.start) || 0) + (Number(current.length) || 1) - 1, frame));
            }}
            onEnded={advance}
          />
        ) : (
          <div className="ltx-preview-placeholder">
            <b>{current?.fileName || "No active take"}</b>
            <small>This segment has no active take yet. Playback skips it.</small>
          </div>
        )}
      </div>
      <div className="ltx-preview-transport">
        <button type="button" className="button secondary" onClick={() => onPlayingChange(!playing)}>{playing ? "Pause" : "Play"}</button>
        <small>{current ? `${current.fileName} · take ${current.take?.id || "none"}` : "No clip"} · {playable.length}/{playlist.length} takes ready</small>
      </div>
    </div>
  );
}

'''
if "function AssembledPreviewPlayer" not in text:
    text = text.replace("export default function LtxDirectorWorkspace() {", player + "export default function LtxDirectorWorkspace() {", 1)
    print("added player component")

old_service = '''        <div className="ltx-service-state"><span className={health?.connected ? "online" : "offline"}><i />LTX {health?.connected ? "Ready" : "Offline"}</span><span className="ltx-profile-chip">{activeProfileLabel}</span><span>{queueMode === "timeline" ? "Semantic timeline" : "Independent segments"}</span><span>ComfyUI {health?.comfyUrl?.replace(/^https?:\\/\\//, "") || "unavailable"}</span><span>{health?.queue?.running || 0} running · {health?.queue?.pending || 0} queued</span></div>'''
new_service = '''        <div className="ltx-service-state"><span className={health?.connected ? "online" : "offline"}><i />LTX {health?.connected ? "Ready" : "Offline"}</span><label className="ltx-generate-option">GENERATE OPTION<select value={generateOptionId} onChange={(event) => void chooseGenerateOption(event.target.value)}>{(generateOptions.length ? generateOptions : [{ id: generateOptionId || "harrowing_aaa_i2v_segmented", label: selectedGenerateOption?.label || "Harrowing AAA I2V · segmented" }]).map((option: any) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><span className="ltx-profile-chip">{activeProfileLabel}</span><span>{queueMode === "timeline" ? "Semantic timeline" : f"{eligibleSegments.length} I2V segment jobs"}</span><span>ComfyUI {health?.comfyUrl?.replace(/^https?:\\/\\//, "") || "unavailable"}</span><span>{health?.queue?.running || 0} running · {health?.queue?.pending || 0} queued</span></div>'''

# The f-string above is wrong - this is TSX not Python. Fix:
new_service = '''        <div className="ltx-service-state"><span className={health?.connected ? "online" : "offline"}><i />LTX {health?.connected ? "Ready" : "Offline"}</span><label className="ltx-generate-option">GENERATE OPTION<select value={generateOptionId} onChange={(event) => void chooseGenerateOption(event.target.value)}>{(generateOptions.length ? generateOptions : [{ id: generateOptionId || "harrowing_aaa_i2v_segmented", label: selectedGenerateOption?.label || "Harrowing AAA I2V · segmented" }]).map((option: any) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><span className="ltx-profile-chip">{activeProfileLabel}</span><span>{queueMode === "timeline" ? "Semantic timeline" : `${eligibleSegments.length} I2V segment jobs`}</span><span>ComfyUI {health?.comfyUrl?.replace(/^https?:\\/\\//, "") || "unavailable"}</span><span>{health?.queue?.running || 0} running · {health?.queue?.pending || 0} queued</span></div>'''

if old_service not in text:
    raise SystemExit("service state not found")
text = text.replace(old_service, new_service, 1)
print("patched generate option header")

old_header = '''          <header><div><span className="workspace-eyebrow">SEGMENT TIMELINE · {activeProfileLabel}</span><h2>{workspace.premiere?.clipId || "Unbound Director workspace"}</h2></div><div><b>{(total / fps).toFixed(1)}s</b><small>{total} editorial frames · {fps} fps · {workspace.settings.customWidth}×{workspace.settings.customHeight}</small></div></header>
          <div className="ltx-ruler">{Array.from({ length: Math.max(2, Math.ceil(total / fps) + 1) }).map((_, index) => <span key={index} style={{ left: `${Math.min(100, (index * fps / total) * 100)}%` }}>{index}s</span>)}</div>
          {([
            ["MAIN", "segments"],
            ["AUDIO", "audioSegments"],
            ["IC-LORA", "motionSegments"]
          ] as const).map(([label, key]) => <div className={`ltx-track ltx-track-${key}`} key={key}><b>{label}</b><div className="ltx-track-lane">{trackSegments(workspace, key).map((segment: any) => <button key={segment.id} className={`${String(segment.id) === String(selected?.id) ? "selected" : ""} ${segment.missingGuide ? "missing" : ""}`} style={{ left: `${((Number(segment.start) || 0) / total) * 100}%`, width: `${Math.max(1.5, ((Number(segment.length) || 1) / total) * 100)}%` }} onClick={() => patchWorkspace((draft) => { draft.selectedSegmentId = segment.id; draft.playheadFrame = Number(segment.start) || 0; })}><span>{segment.fileName || segment.id}</span><small>{((Number(segment.length) || 1) / fps).toFixed(1)}s</small></button>)}</div></div>)}
          <div className="ltx-playhead" style={{ left: `calc(92px + (100% - 104px) * ${Math.max(0, Number(workspace.playheadFrame) || 0) / total})` }} />
'''
new_header = '''          <header><div><span className="workspace-eyebrow">SEGMENT TIMELINE · {activeProfileLabel}</span><h2>{workspace.premiere?.clipId || "Unbound Director workspace"}</h2></div><div className="ltx-timeline-header-meta"><button type="button" className="ltx-timeline-toggle" onClick={() => { setTimelinePreview((value) => !value); setPreviewPlaying(false); }}>{timelinePreview ? "Timeline" : "Preview"}</button><b>{(total / fps).toFixed(1)}s</b><small>{total} editorial frames · {fps} fps · {workspace.settings.customWidth}×{workspace.settings.customHeight}</small></div></header>
          {timelinePreview ? <AssembledPreviewPlayer playlist={playlist} fps={fps} playheadFrame={Number(workspace.playheadFrame) || 0} playing={previewPlaying} previewIndex={previewIndex} onPlayhead={(frame) => setWorkspace((current: any) => current ? { ...current, playheadFrame: frame } : current)} onPlayingChange={setPreviewPlaying} onPreviewIndex={setPreviewIndex} onSelectSegment={(segmentId, frame) => setWorkspace((current: any) => current ? { ...current, selectedSegmentId: segmentId, playheadFrame: frame } : current)} /> : <>
          <div className="ltx-ruler">{Array.from({ length: Math.max(2, Math.ceil(total / fps) + 1) }).map((_, index) => <span key={index} style={{ left: `${Math.min(100, (index * fps / total) * 100)}%` }}>{index}s</span>)}</div>
          {([
            ["MAIN", "segments"],
            ["AUDIO", "audioSegments"],
            ["IC-LORA", "motionSegments"]
          ] as const).map(([label, key]) => <div className={`ltx-track ltx-track-${key}`} key={key}><b>{label}</b><div className="ltx-track-lane">{trackSegments(workspace, key).map((segment: any) => <button key={segment.id} className={`${String(segment.id) === String(selected?.id) ? "selected" : ""} ${segment.missingGuide ? "missing" : ""}`} style={{ left: `${((Number(segment.start) || 0) / total) * 100}%`, width: `${Math.max(1.5, ((Number(segment.length) || 1) / total) * 100)}%` }} onClick={() => patchWorkspace((draft) => { draft.selectedSegmentId = segment.id; draft.playheadFrame = Number(segment.start) || 0; })}><span>{segment.fileName || segment.id}</span><small>{((Number(segment.length) || 1) / fps).toFixed(1)}s</small></button>)}</div></div>)}
          <div className="ltx-playhead" style={{ left: `calc(92px + (100% - 104px) * ${Math.max(0, Number(workspace.playheadFrame) || 0) / total})` }} />
          </>}
'''
if old_header not in text:
    raise SystemExit("timeline header not found")
text = text.replace(old_header, new_header, 1)
print("patched timeline toggle")

old_ref = '''          <header><div><b>REFERENCE INPUTS</b><small>{selectedTrack} segment · roles stay separate</small></div><button type="button" disabled={diagnosticsBusy || !workspace?.premiere?.clipId} onClick={() => refreshDiagnostics(workspace?.premiere?.clipId)}>{diagnosticsBusy ? "Checking…" : "Recheck"}</button></header>
'''
new_ref = '''          <header><div><b>REFERENCE INPUTS</b><small>{selectedTrack} segment · {referenceTab === "library" ? `${selectedTakes.length} take${selectedTakes.length === 1 ? "" : "s"}` : "roles stay separate"}</small></div><div className="ltx-reference-header-actions"><div className="ltx-panel-tabs" role="tablist" aria-label="Reference panel"><button type="button" role="tab" aria-selected={referenceTab === "inputs"} className={referenceTab === "inputs" ? "active" : ""} onClick={() => setReferenceTab("inputs")}>Inputs</button><button type="button" role="tab" aria-selected={referenceTab === "library"} className={referenceTab === "library" ? "active" : ""} onClick={() => setReferenceTab("library")}>Library</button></div><button type="button" disabled={diagnosticsBusy || !workspace?.premiere?.clipId} onClick={() => refreshDiagnostics(workspace?.premiere?.clipId)}>{diagnosticsBusy ? "Checking…" : "Recheck"}</button></div></header>
          {referenceTab === "library" ? <section className="ltx-reference-group ltx-library-group" aria-labelledby="ltx-library-heading">
            <div className="ltx-reference-heading"><div><span className="workspace-eyebrow">SEGMENT LIBRARY</span><b id="ltx-library-heading">{selected?.id || "No selection"}</b></div><small>{selectedTakes.length} iteration{selectedTakes.length === 1 ? "" : "s"}</small></div>
            <p className="ltx-library-help">Click a take to make it the active segment output. No extra confirm.</p>
            <div className="ltx-library-grid">
              {selectedTakes.map((take: any) => {
                const active = String(take.id) === String(selectedActiveTake?.id || selected?.activeTakeId);
                return <button type="button" key={take.id || take.v} className={`ltx-library-card ${active ? "active" : ""}`} onClick={() => void activateTake(take)}>
                  <div className="ltx-reference-thumb">{takePreviewUrl(project.slug, take) ? <video src={takePreviewUrl(project.slug, take)} muted playsInline preload="metadata" /> : <span aria-hidden="true">◇</span>}</div>
                  <strong>{take.id || `v${take.v}`}</strong>
                  <small>{active ? "ACTIVE" : "Click to activate"}{take.createdAt ? ` · ${new Date(take.createdAt).toLocaleString()}` : ""}</small>
                </button>;
              })}
              {!selectedTakes.length ? <p className="ltx-reference-empty">No generated takes yet for this segment. Queue the segment to create the first iteration.</p> : null}
            </div>
          </section> : null}
'''
if old_ref not in text:
    raise SystemExit("reference header not found")
text = text.replace(old_ref, new_ref, 1)
print("patched library tab")

# Wrap existing input sections so they hide on library tab
old_temp = '''          <section className="ltx-reference-group" aria-labelledby="ltx-temporal-heading">'''
new_temp = '''          {referenceTab === "inputs" ? <section className="ltx-reference-group" aria-labelledby="ltx-temporal-heading">'''
if old_temp not in text:
    raise SystemExit("temporal section not found")
text = text.replace(old_temp, new_temp, 1)

old_auto = '''          {queueMode === "segments" ? <section className="ltx-frame-plan" aria-labelledby="ltx-frame-plan-heading">'''
new_auto = '''          {referenceTab === "inputs" && queueMode === "segments" ? <section className="ltx-frame-plan" aria-labelledby="ltx-frame-plan-heading">'''
if old_auto not in text:
    raise SystemExit("auto length not found")
text = text.replace(old_auto, new_auto, 1)

# close the inputs fragment after frame plan section - actually temporal/semantic/frameplan should all be inside referenceTab==inputs
# I only opened on temporal. Need to wrap semantic too... semantic is always shown after temporal.
# Close after frame plan's ternary null.
old_close = '''          </section> : null}
        </aside>'''
new_close = '''          </section> : null}
          : null}
        </aside>'''
if old_close not in text:
    raise SystemExit("aside close not found")
text = text.replace(old_close, new_close, 1)
print("wrapped inputs tab")

# footer queue label more explicit
text = text.replace(
    "{queueMode === \"timeline\" ? \"Queue Semantic Timeline\" : \"Queue All Segments\"}",
    "{queueMode === \"timeline\" ? \"Queue Semantic Timeline\" : `Queue All Segments (${eligibleSegments.length})`}"
)

p.write_text(text, encoding="utf-8")
print("ui jsx patched", len(text.splitlines()))
