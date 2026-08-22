import React, { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, useStore } from "../store";
import { openAssetAction, resultActions, useAssetActionStore, type AssetActionName } from "../contextual-agency";
import { MANUAL_ACTIONS } from "../contextual-agency/agency.js";
import {
  attachForIntent,
  approveForIntent,
  chooseForIntent,
  createPlannedAsset,
  generateBlockReason,
  generateForIntent,
  isVoiceCategory,
  unlinkForIntent,
  uploadForIntent,
  restoreForIntent,
  previousVersion,
  nextMissingIntent,
  reuseExistingVersion,
  attachAudit,
  attachAuditLine,
  auditionNativeUrl,
  fetchVoiceDesignState,
  saveAuditionToLibrary,
  selectAudition,
  sessionFromVoiceDesign,
  withContinuityLocks
} from "../contextual-agency/agency-actions.js";
import { activeAssetFile } from "../character-assets";
import "./asset-action-drawer.css";

const MODE_LABEL: Record<AssetActionName, string> = {
  generate: "Generate",
  upload: "Upload",
  create: "Create manually",
  choose: "Choose existing",
  edit: "Edit",
  replace: "Replace",
  review: "Review",
  assign: "Assign",
  attach: "Attach",
  restore: "Restore",
  unlink: "Unlink",
  versions: "Versions"
};

function isLastGuideRel(relationship?: string) {
  const rel = String(relationship || "");
  return rel === "ltx.lastGuide" || rel === "ltx.temporalGuide.last" || rel === "last guide" || rel.endsWith(".last") || rel.includes("lastGuide");
}

function mediaAccept(mediaType?: string) {
  if (mediaType === "audio") return "audio/wav,audio/mpeg,audio/flac,audio/mp4,audio/aac,audio/ogg,.wav,.mp3,.flac,.m4a,.aac,.ogg";
  return "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
}

export default function AssetActionDrawer() {
  const store = useStore();
  const { intent, mode, lastResult, setMode, close, complete } = useAssetActionStore();
  const panelRef = useRef<HTMLElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [variant, setVariant] = useState("Production Reference");
  const [prompt, setPrompt] = useState("");
  const [chooseId, setChooseId] = useState("");
  const [assignCharacterId, setAssignCharacterId] = useState("");
  const [auditionText, setAuditionText] = useState("The hour has come.");
  const [session, setSession] = useState<any>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [duplicateHit, setDuplicateHit] = useState<any>(null);
  const [auditRow, setAuditRow] = useState<any>(null);

  const project = store.project;
  const items = project?.assets?.items || [];
  const workingAsset = useMemo(() => {
    if (!intent) return null;
    return items.find((item: any) => item.id === intent.requirement.assetId) || null;
  }, [intent, items]);

  useEffect(() => {
    if (!intent) return;
    setNotice("");
    setError("");
    setName(workingAsset?.name || intent.prefill?.name || intent.sourceEntity.label || "");
    setVariant(workingAsset?.variant || (intent.requirement.category === "voice" ? "Voice Design" : "Production Reference"));
    setPrompt(workingAsset?.prompt || intent.prefill?.prompt || "");
    setChooseId(intent.requirement.assetId || "");
    setAssignCharacterId(intent.sourceEntity.type === "character" ? intent.sourceEntity.id : "");
    const cueLines = Array.isArray(intent.prefill?.cueLines) ? intent.prefill.cueLines.map((item: string) => String(item || "").trim()).filter(Boolean) : [];
    const cueLine = String(intent.prefill?.sampleText || "").trim() || cueLines[0] || "";
    const fromCue = intent.requirement.category === "dialogue" || String(intent.requirement.relationship || "").includes("dialogue") || String(intent.requirement.relationship || "").includes("cue");
    const voiceEmpty = intent.requirement.category === "voice";
    setAuditionText(fromCue || voiceEmpty ? (cueLine || "") : (workingAsset?.sampleText || cueLine || ""));
    const locks = intent.prefill?.continuity || intent.prefill?.continuityLocks || workingAsset?.continuity || [];
    if (Array.isArray(locks) && locks.length) {
      setPrompt((current) => {
        const base = workingAsset?.prompt || intent.prefill?.prompt || current || "";
        return withContinuityLocks(base, locks);
      });
    }
    setSession(null);
    setCompareIds([]);
    setDuplicateHit(null);
  }, [intent?.sourceEntity.id, intent?.requirement.relationship, workingAsset?.id]);

  useEffect(() => {
    if (!intent) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    const focusable = panelRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea");
    focusable?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [intent, close, busy]);

  useEffect(() => {
    if (!intent || !project || !session?.id) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const snapshot = await fetchVoiceDesignState(project.slug);
        const next = sessionFromVoiceDesign(snapshot, session.id);
        if (!cancelled && next) setSession(next);
      } catch {
        /* keep the last session while the job is still running */
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [intent, project?.slug, session?.id]);

  if (!intent || !project) return null;

  const category = intent.requirement.category;
  const mediaType = intent.requirement.expectedMediaType || (category === "voice" || category === "dialogue" || category === "sound" || category === "music" ? "audio" : "image");
  const characterId = intent.sourceEntity.type === "character" ? intent.sourceEntity.id : "";
  const generateReason = generateBlockReason(intent, store.health);
  const generateBlocked = Boolean(generateReason);
  const dialogueMode = category === "dialogue";
  const voiceMode = category === "voice";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const mark = (asset: any, kind: "created" | "generated" | "uploaded" | "imported" | "assigned") => {
    if (!asset) return;
    complete({
      assetId: asset.id,
      version: asset.activeVersion,
      file: activeAssetFile(asset) || undefined,
      approved: Boolean(asset.approvalCurrent),
      kind
    });
    setNotice(`${kind} ${asset.name || asset.id}${asset.activeVersion ? ` v${asset.activeVersion}` : ""}. Approval stays explicit.`);
  };

  const rememberAsset = (asset: any) => {
    useAssetActionStore.setState({
      intent: { ...intent, requirement: { ...intent.requirement, assetId: asset.id, assetVersion: asset.activeVersion } }
    });
  };

  const onCreate = () => run(async () => {
    const created = await createPlannedAsset(store, intent, { name: name.trim(), variant, prompt, sampleText: auditionText });
    rememberAsset(created);
    mark(created, "created");
  });

  const onEdit = () => run(async () => {
    const asset = workingAsset || await createPlannedAsset(store, intent, { name: name.trim(), variant, prompt, sampleText: auditionText });
    await store.patchAsset(asset.id, { name: name.trim(), variant, prompt, sampleText: auditionText });
    rememberAsset(asset);
    mark({ ...asset, name: name.trim(), variant, prompt }, "created");
  });

  const onUpload = (file: File) => run(async () => {
    try {
      const next = await uploadForIntent(store, intent, file, workingAsset);
      rememberAsset(next);
      mark(next, "uploaded");
    } catch (error: any) {
      if (error?.code === "DUPLICATE_HASH" && error.existing) {
        setDuplicateHit(error.existing);
        setNotice(`Exact SHA-256 already exists as ${error.existing.asset.name} v${error.existing.version.v}. Reuse that version? A new vN+1 was not created.`);
        return;
      }
      throw error;
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  });

  const onReuseDuplicate = () => run(async () => {
    if (!duplicateHit) return;
    const reused = reuseExistingVersion(duplicateHit);
    rememberAsset(reused.asset);
    mark(reused.asset, "imported");
    setDuplicateHit(null);
    setNotice(`Reused ${reused.asset.name} v${reused.asset.activeVersion}. No new version was minted. Approval stays explicit.`);
  });

  const onGenerate = () => run(async () => {
    const result = await generateForIntent(store, intent, {
      name: name.trim(),
      variant,
      prompt,
      instruct: prompt,
      voiceName: name.trim() || intent.sourceEntity.label,
      auditionText,
      sampleText: auditionText,
      cueLines: intent.prefill?.cueLines,
      continuity: intent.prefill?.continuity || intent.prefill?.continuityLocks,
      asset: workingAsset
    });
    if (result.provider === "qwen-tts") {
      const attachBack = intent.requirement.relationship === "ltx.dialogueCue" ? "Attach-back binds the LTX dialogue cue." : "Attach-back stays on the segment dialogue slot.";
      setNotice(`Queued Qwen TTS of this cue${result.job?.id ? ` · job ${result.job.id}` : ""}. Not Voice Design. ${attachBack}`);
      return;
    }
    if (result.provider === "qwen-voice-design") {
      setSession(result.session || { id: result.session?.id, auditions: [] });
      setNotice(`Queued ${result.session?.auditions?.length || 3} Qwen auditions${result.job?.id ? ` · job ${result.job.id}` : ""}. Qwen stayed the provider.`);
      return;
    }
    rememberAsset(result.asset);
    mark(result.asset, "generated");
    if (result.attached) setNotice(`Generated and attached ${result.asset.name} to ${intent.sourceEntity.label}. Approval stays explicit.`);
  });

  const onChoose = () => run(async () => {
    const asset = items.find((item: any) => item.id === chooseId);
    const chosen = await chooseForIntent(store, intent, asset);
    rememberAsset(chosen);
    mark(chosen, "assigned");
  });

  const onAttach = () => run(async () => {
    const assetId = lastResult?.assetId || workingAsset?.id || chooseId;
    const asset = items.find((item: any) => item.id === assetId);
    const previousRelationship = auditRow?.relationship || "";
    const result = await attachForIntent(store, intent, asset);
    const audit = result.audit || attachAudit(intent, result.asset || asset, result, { previousRelationship });
    setAuditRow(audit);
    mark(result.asset, "assigned");
    setNotice(attachAuditLine(audit));
  });

  const onUnlink = () => run(async () => {
    await unlinkForIntent(store, intent, workingAsset);
    setNotice(`Unlinked ${workingAsset.name} from ${intent.sourceEntity.label}.`);
  });

  const onReview = () => run(async () => {
    const asset = workingAsset || items.find((item: any) => item.id === lastResult?.assetId);
    const approved = await approveForIntent(store, asset);
    mark(approved, "assigned");
    setNotice(`Approved ${approved.name} v${approved.activeVersion}. It did not auto-promote.`);
  });


  const onRestore = (versionNumber?: number) => run(async () => {
    const next = await restoreForIntent(store, workingAsset, versionNumber);
    rememberAsset(next);
    mark(next, "assigned");
    if (next.restoreAudit) setAuditRow(next.restoreAudit);
    setNotice(`Restored ${next.name} v${next.activeVersion}. Later versions kept (${(next.restoreAudit?.keptVersions || []).join(", ") || "all"}). Approval stays explicit.`);
  });

  const onAssignRecording = () => run(async () => {
    const sourceId = intent.sourceEntity.id;
    const targetId = assignCharacterId || characterId;
    if (!targetId) throw new Error("Pick a character to assign this recording.");
    const target = items.find((item: any) => item.id === targetId && item.category === "character");
    if (!target) throw new Error("Character not found.");
    const created = await createPlannedAsset(store, {
      ...intent,
      sourceEntity: { type: "character", id: target.id, label: target.name },
      requirement: { ...intent.requirement, category: "voice", relationship: "character.voice" }
    }, { name: target.name, variant: "Voice Design", prompt: `Stable cinematic voice identity for ${target.name}.` });
    const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/character-voice-sources/${encodeURIComponent(sourceId)}/audio`);
    if (!response.ok) throw new Error("Could not read the Audacity take.");
    const blob = await response.blob();
    const file = new File([blob], `${sourceId}.wav`, { type: blob.type || "audio/wav" });
    const uploaded = await store.uploadAssetAudio(created.id, file);
    mark(uploaded || created, "imported");
  });

  const candidates = items.filter((item: any) => item.category === category);
  const characters = items.filter((item: any) => item.category === "character");
  const previewFile = workingAsset ? activeAssetFile(workingAsset) : null;
  const followUps = lastResult ? resultActions(intent, lastResult) : [];

  return (
    <div className="asset-action-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <aside ref={panelRef} className="asset-action-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-action-title">
        <header>
          <div>
            <span className="workspace-eyebrow">CONTEXTUAL ASSET ACTION</span>
            <h2 id="asset-action-title">{intent.sourceEntity.label}</h2>
            <p>{intent.requirement.relationship} · {category}{workingAsset ? ` · ${workingAsset.id}` : ""}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close asset action drawer" onClick={close} disabled={busy}>×</button>
        </header>

        <nav className="asset-action-modes" aria-label="Asset action modes">
          {(["generate", "upload", "create", "choose", "edit", "replace", "review", "assign", "attach", "restore", "versions", "unlink"] as AssetActionName[]).map((name) => (
            <button key={name} type="button" className={mode === name ? "active" : ""} data-action={name} aria-pressed={mode === name} onClick={() => setMode(name)} disabled={busy}>
              {MODE_LABEL[name]}
              {MANUAL_ACTIONS.includes(name) ? null : <em>model</em>}
            </button>
          ))}
        </nav>

        <section className="asset-action-body">
          {error ? <p className="asset-action-error" role="alert">{error}</p> : null}
          {notice ? <p className="asset-action-ok" role="status">{notice}</p> : null}
          {duplicateHit ? (
            <div className="asset-action-form" role="alertdialog" aria-label="Reuse existing version">
              <p>Exact SHA-256 already exists as {duplicateHit.asset.name} v{duplicateHit.version.v}. Reuse that version? This will not mint a silent vN+1 and will not overwrite vN.</p>
              <div className="requirement-slot-actions">
                <button type="button" className="button primary" disabled={busy} onClick={() => void onReuseDuplicate()}>Reuse existing version</button>
                <button type="button" className="button secondary" disabled={busy} onClick={() => setDuplicateHit(null)}>Cancel</button>
              </div>
            </div>
          ) : null}

          {auditRow ? (
            <dl className="asset-action-audit" aria-label="Attach audit">
              <div><dt>Source entity</dt><dd>{auditRow.sourceEntity || `${auditRow.op || "restore"}`}</dd></div>
              <div><dt>Relationship</dt><dd>{auditRow.relationship || "restore"}</dd></div>
              <div><dt>Previous relationship</dt><dd>{auditRow.previousRelationship || "none"}</dd></div>
              <div><dt>Asset id</dt><dd>{auditRow.assetId}</dd></div>
              <div><dt>Exact version</dt><dd>v{auditRow.exactVersion || auditRow.toVersion}</dd></div>
              <div><dt>Previous version</dt><dd>{auditRow.previousVersion ? `v${auditRow.previousVersion}` : "none"}</dd></div>
              <div><dt>Approval fingerprint</dt><dd>{auditRow.approvalFingerprint || "none"}</dd></div>
              <div><dt>Timestamp</dt><dd>{auditRow.timestamp}</dd></div>
              <div><dt>Op source</dt><dd>{auditRow.opSource}</dd></div>
            </dl>
          ) : null}



          {mode === "create" || mode === "edit" ? (
            <form className="asset-action-form" onSubmit={(event) => { event.preventDefault(); void (mode === "create" ? onCreate() : onEdit()); }}>
              <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} /></label>
              <label>Variant<input value={variant} onChange={(event) => setVariant(event.target.value)} maxLength={120} /></label>
              <label>Direction<textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
              <button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : mode === "create" ? "Create asset" : "Save details"}</button>
            </form>
          ) : null}

          {mode === "upload" || mode === "replace" ? (
            <div className="asset-action-form">
              <p>Creates vN+1. The new version starts unapproved and does not overwrite vN.</p>
              <input ref={fileRef} type="file" accept={mediaAccept(mediaType)} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onUpload(file);
              }} />
              <button type="button" className="button primary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Uploading…" : mediaType === "audio" ? "Upload audio" : "Upload image"}</button>
            </div>
          ) : null}

          {mode === "generate" ? (
            <div className="asset-action-form">
              <p>{dialogueMode ? "Queues Qwen TTS of this cue. This is not Voice Design and it does not mint character auditions." : voiceMode ? "Queues three Qwen Voice Design auditions so you can compare, save, and attach here. Qwen is the only voice provider here." : "Queues ComfyUI generation for this visual slot, then attaches the result to the originating requirement."}</p>
              {dialogueMode ? <label>Dialogue cue<textarea rows={4} value={auditionText} onChange={(event) => setAuditionText(event.target.value)} /></label> : null}
              {voiceMode ? <label>Audition line<textarea rows={3} value={auditionText} onChange={(event) => setAuditionText(event.target.value)} placeholder="Use a cue line for this character" /></label> : null}
              {voiceMode && Array.isArray(intent.prefill?.cueLines) && intent.prefill.cueLines.length ? (
                <div className="requirement-slot-actions" aria-label="Character cue lines">
                  {intent.prefill.cueLines.map((line: string) => (
                    <button key={line} type="button" className="button secondary" onClick={() => setAuditionText(line)}>{line}</button>
                  ))}
                </div>
              ) : null}
              {voiceMode ? <label>Voice direction<textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label> : null}
              {generateReason ? <p className="muted">{generateReason}</p> : <p className="muted">Upload, create, choose, and review stay available if generate is offline.</p>}
              <button type="button" className="button primary" disabled={busy || generateBlocked} title={generateReason || "Generate this requirement"} onClick={() => void onGenerate()}>{busy ? "Queueing…" : dialogueMode ? "Generate dialogue" : voiceMode ? "Generate 3 Qwen auditions" : workingAsset ? "Generate and attach" : "Create, generate, and attach"}</button>
              {error && !generateBlocked ? <button type="button" className="button secondary" disabled={busy} onClick={() => void onGenerate()}>Retry last generate</button> : null}
              {voiceMode && session ? (
                <div className="asset-action-auditions" aria-label="Qwen auditions">
                  <b>{session.status || "queued"} · {(session.auditions || []).length} take{(session.auditions || []).length === 1 ? "" : "s"}</b>
                  {compareIds.length ? (
                    <div className="asset-action-compare" aria-label="Compare Qwen takes">
                      <p>Comparing {compareIds.length} take{compareIds.length === 1 ? "" : "s"} side by side. Pick a second take if only one is selected.</p>
                      <div className="asset-action-compare-grid">
                        {compareIds.map((id) => {
                          const audition = (session.auditions || []).find((item: any) => item.id === id);
                          if (!audition) return null;
                          return (
                            <article key={`compare-${id}`}>
                              <header><span>{audition.name || audition.id}</span><em>compare</em></header>
                              <audio src={auditionNativeUrl(project.slug, audition.id)} controls preload="none" />
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {(session.auditions || []).map((audition: any) => {
                    const ready = ["ready", "done", "completed", "succeeded", "selected", "saved"].includes(String(audition.status || ""));
                    const comparing = compareIds.includes(audition.id);
                    return (
                      <article key={audition.id} className={comparing ? "comparing" : undefined}>
                        <header>
                          <span>{audition.name || audition.id}</span>
                          <em>{audition.status || "queued"}</em>
                        </header>
                        {ready ? <audio src={auditionNativeUrl(project.slug, audition.id)} controls preload="none" /> : <p className="muted">Waiting on Qwen…</p>}
                        <div className="requirement-slot-actions">
                          <button type="button" className="button secondary" disabled={!ready} onClick={() => setCompareIds((current) => current.includes(audition.id) ? current.filter((id) => id !== audition.id) : [...current.slice(-1), audition.id])}>{comparing ? "In compare" : "Compare"}</button>
                          <button type="button" className="button secondary" disabled={busy || !ready} onClick={() => run(async () => {
                            const saved = await saveAuditionToLibrary(project.slug, audition.id);
                            if (saved.asset) {
                              rememberAsset(saved.asset);
                              mark(saved.asset, "generated");
                            }
                            setNotice(`Saved ${audition.id} in this session. Approval stays explicit.`);
                          })}>Save take</button>
                          <button type="button" className="button secondary" disabled={busy || !ready} onClick={() => run(async () => {
                            const selected = await selectAudition(project.slug, audition.id);
                            const asset = selected.asset;
                            if (asset) {
                              rememberAsset(asset);
                              try { await attachForIntent(store, intent, asset); } catch { /* save still counts */ }
                              mark(asset, "assigned");
                            }
                            setNotice(`Assigned ${audition.id} to ${intent.sourceEntity.label}. Still on this character. Qwen stayed the provider.`);
                          })}>Assign to this character</button>
                          <button type="button" className="button primary" disabled={busy || !ready} onClick={() => run(async () => {
                            const selected = await selectAudition(project.slug, audition.id);
                            let asset = selected.asset;
                            if (!asset) throw new Error("Qwen did not return a library asset for this take.");
                            rememberAsset(asset);
                            try { await attachForIntent(store, intent, asset); } catch { /* approve can still run */ }
                            asset = await approveForIntent(store, asset);
                            mark(asset, "assigned");
                            setNotice(`Approved ${asset.name} v${asset.activeVersion} for ${intent.sourceEntity.label}. Did not leave the character.`);
                          })}>Approve this take</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === "choose" ? (
            <div className="asset-action-form">
              <label>Existing {category}
                <select value={chooseId} onChange={(event) => setChooseId(event.target.value)}>
                  <option value="">Select an asset</option>
                  {candidates.map((item: any) => <option key={item.id} value={item.id}>{item.name} · {item.variant}{item.approvalCurrent ? " · approved" : ""}</option>)}
                </select>
              </label>
              <button type="button" className="button primary" disabled={busy || !chooseId} onClick={() => void onChoose()}>{busy ? "Assigning…" : "Assign to this slot"}</button>
            </div>
          ) : null}

          {mode === "review" ? (
            <div className="asset-action-form">
              {previewFile && mediaType !== "audio" ? <img src={assetUrl(project.slug, previewFile)} alt="" /> : null}
              {previewFile && mediaType === "audio" ? <audio src={assetUrl(project.slug, previewFile)} controls preload="none" /> : null}
              <p>{workingAsset ? `${workingAsset.name} v${workingAsset.activeVersion || 0}` : "No asset loaded."}</p>
              <button type="button" className="button primary" disabled={busy || !workingAsset} onClick={() => void onReview()}>{busy ? "Approving…" : "Approve this version"}</button>
            </div>
          ) : null}

          {mode === "attach" ? (
            <div className="asset-action-form">
              <p>{intent.sourceEntity.type === "guide" ? (isLastGuideRel(intent.requirement.relationship) ? "Pins this file as the LTX last temporal guide for the selected segment." : "Pins this file as the LTX first temporal guide for the selected segment.") : intent.sourceEntity.type === "character" ? "Writes the character relationship onto the result." : intent.requirement.relationship === "ltx.dialogueCue" ? "Binds this take to the LTX dialogue cue. Not a Storyboard pin." : intent.requirement.relationship === "segment.dialogueAudio" ? "Pins this take to the segment dialogue slot. Not a visual reference." : "Pins this asset as a Storyboard semantic reference."} Approval is unchanged.</p>
              <button type="button" className="button primary" disabled={busy || !(lastResult?.assetId || workingAsset || chooseId)} onClick={() => void onAttach()}>{busy ? "Attaching…" : intent.sourceEntity.type === "guide" ? (isLastGuideRel(intent.requirement.relationship) ? "Use as last" : "Use as first") : intent.requirement.relationship === "ltx.dialogueCue" ? "Attach to LTX dialogue cue" : (intent.requirement.category === "dialogue" || String(intent.requirement.relationship || "").includes("dialogue") || String(intent.requirement.relationship || "").includes("cue")) ? "Attach to this cue" : `Attach to ${intent.sourceEntity.label}`}</button>
            </div>
          ) : null}

          {mode === "assign" ? (
            <div className="asset-action-form">
              <p>Assign this recording without relying on filename matching. Duplicate hashes stay blocked by the upload path.</p>
              <label>Character
                <select value={assignCharacterId} onChange={(event) => setAssignCharacterId(event.target.value)}>
                  <option value="">Select a character</option>
                  {characters.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <button type="button" className="button primary" disabled={busy || !assignCharacterId} onClick={() => void onAssignRecording()}>{busy ? "Assigning…" : "Create voice and import take"}</button>
            </div>
          ) : null}


          {mode === "restore" ? (
            <div className="asset-action-form">
              <p>Restores an earlier version as the active take. It does not overwrite the newer files and it does not silently approve.</p>
              <button type="button" className="button primary" disabled={busy || !workingAsset || !previousVersion(workingAsset)} onClick={() => void onRestore()}>{busy ? "Restoring…" : previousVersion(workingAsset) ? `Restore v${previousVersion(workingAsset).v}` : "No earlier version"}</button>
              <ul className="asset-action-versions">
                {(workingAsset?.versions || []).length ? workingAsset.versions.map((version: any) => (
                  <li key={version.v}>
                    v{version.v}{Number(version.v) === Number(workingAsset.activeVersion) ? " · active" : ""} · {version.file || "no file"}
                    {Number(version.v) !== Number(workingAsset.activeVersion) ? <button type="button" className="button secondary" disabled={busy} onClick={() => void onRestore(Number(version.v))}>Restore this version</button> : null}
                  </li>
                )) : <li>No versions yet.</li>}
              </ul>
            </div>
          ) : null}

          {mode === "versions" ? (
            <ul className="asset-action-versions">
              {(workingAsset?.versions || []).length ? workingAsset.versions.map((version: any) => (
                <li key={version.v}>v{version.v}{Number(version.v) === Number(workingAsset.activeVersion) ? " · active" : ""} · {version.file || "no file"}</li>
              )) : <li>No versions yet.</li>}
            </ul>
          ) : null}

          {mode === "unlink" ? (
            <button type="button" className="button secondary" disabled={busy || !workingAsset} onClick={() => void onUnlink()}>{busy ? "Unlinking…" : "Unlink from this character"}</button>
          ) : null}

          {followUps.length ? (
            <div className="asset-action-result" role="status">
              <b>Next</b>
              <div className="requirement-slot-actions">
                {followUps.map((action) => (
                  <button key={action.id} type="button" className="button primary" onClick={() => {
                    if (action.kind === "attach") { setMode("attach"); void onAttach(); }
                    else if (action.kind === "review") setMode("review");
                    else if (action.kind === "versions") setMode("versions");
                    else if (action.kind === "continue") {
                      const next = nextMissingIntent(store, intent);
                      if (next) openAssetAction(next);
                      else close();
                    }
                  }}>{action.label}</button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
