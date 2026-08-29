import React, { useEffect, useState } from "react";
import { useStore } from "../store";

const SHA256_RE = /^[a-f0-9]{64}$/i;

export function continuityFrameHasVerifiedEvidence(frame: any) {
  const evidence = frame?.continuityEvidence;
  const source = evidence?.sourceTake;
  const output = evidence?.output;
  return Boolean(
    frame?.source === "take-continuity" &&
    frame?.generator === "extracted-take-frame" &&
    evidence?.schemaVersion === "premiere316.continuity-evidence.v1" &&
    evidence?.status === "verified" &&
    source?.approval?.status === "approved" &&
    source?.clipId && source?.kind && source?.id && source?.file &&
    Number.isInteger(Number(source?.version)) && Number(source.version) > 0 &&
    source.approval.takeId === source.id &&
    source.approval.takeKind === source.kind &&
    Number(source.approval.takeVersion) === Number(source.version) &&
    SHA256_RE.test(String(source?.sha256 || "")) &&
    Number.isSafeInteger(Number(source?.bytes)) && Number(source.bytes) > 0 &&
    Number.isInteger(Number(output?.decodedFrameIndex)) && Number(output.decodedFrameIndex) >= 0 &&
    output?.file === frame?.file &&
    output?.sha256 === frame?.sha256 &&
    Number(output?.bytes) === Number(frame?.bytes) &&
    SHA256_RE.test(String(output?.sha256 || "")) &&
    Number.isSafeInteger(Number(output?.bytes)) && Number(output.bytes) > 0 &&
    String(frame?.file || "").endsWith(`_${String(output?.sha256 || "").toLowerCase()}.png`)
  );
}

function responseContainsAppliedEvidence(body: any) {
  const storedFrame = body?.project?.frames?.find((frame: any) => (
    frame?.id === body?.frame?.id && frame?.file === body?.frame?.file
  ));
  if (!body?.nextClipId || !continuityFrameHasVerifiedEvidence(storedFrame)) return false;
  const sequenceClip = body.project?.sequence?.clips?.find((clip: any) => clip?.id === body.nextClipId);
  const sequenceApplied = Boolean(
    sequenceClip?.guides?.some((guide: any) => guide?.role === "first" && guide?.file === storedFrame.file) &&
    sequenceClip?.firstFrame?.file === storedFrame.file
  );
  const storyboardClip = body.storyboard?.clips?.[body.nextClipId];
  const storyboardFrame = body.storyboard?.frames?.[storyboardClip?.firstFrameId];
  const storyboardApplied = storyboardFrame?.generatedFile === storedFrame.file;
  return Boolean(sequenceApplied || storyboardApplied);
}

function eligiblePreflightResponse(body: any, clipId: string) {
  const candidate = body?.candidate;
  const approval = candidate?.approval;
  return Boolean(
    body?.eligible === true &&
    String(body?.sourceClipId || "") === String(clipId) &&
    body?.nextClipId &&
    candidate?.selector && candidate?.id && candidate?.kind && candidate?.file &&
    Number.isInteger(Number(candidate?.v)) && Number(candidate.v) > 0 &&
    SHA256_RE.test(String(candidate?.sha256 || "")) &&
    Number.isSafeInteger(Number(candidate?.bytes)) && Number(candidate.bytes) > 0 &&
    approval?.status === "approved" &&
    approval?.takeId === candidate.id &&
    approval?.takeKind === candidate.kind &&
    Number(approval?.takeVersion) === Number(candidate.v)
  );
}

type ContinuityPreflight = {
  key: string;
  loading: boolean;
  eligible: boolean;
  reason: string;
  candidate: any | null;
  nextClipId: string | null;
};

export default function ContinuityAction({
  clipId,
  nextClipId
}: {
  clipId: string;
  nextClipId?: string;
}) {
  const projectSlug = useStore((state) => state.project?.slug);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const requestKey = `${projectSlug || ""}|${clipId || ""}|${nextClipId || ""}`;
  const [preflight, setPreflight] = useState<ContinuityPreflight>({
    key: requestKey,
    loading: true,
    eligible: false,
    reason: "Checking for an exact approved source take…",
    candidate: null,
    nextClipId: null
  });

  useEffect(() => {
    const key = requestKey;
    const controller = new AbortController();
    setNotice(null);
    if (!projectSlug || !clipId) {
      setPreflight({
        key,
        loading: false,
        eligible: false,
        reason: "Select a project clip before promoting continuity.",
        candidate: null,
        nextClipId: null
      });
      return () => controller.abort();
    }

    setPreflight({
      key,
      loading: true,
      eligible: false,
      reason: "Checking for an exact approved source take…",
      candidate: null,
      nextClipId: null
    });
    const query = new URLSearchParams({ clipId });
    if (nextClipId) query.set("nextClipId", nextClipId);
    void fetch(`/api/projects/${encodeURIComponent(projectSlug)}/continuity/preflight?${query}`, {
      signal: controller.signal
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Continuity preflight failed (${response.status}).`);
      if (!eligiblePreflightResponse(body, clipId)) {
        setPreflight({
          key,
          loading: false,
          eligible: false,
          reason: String(body.reason || "No exact approved take with verified SHA-256/byte provenance is available."),
          candidate: null,
          nextClipId: null
        });
        return;
      }
      setPreflight({
        key,
        loading: false,
        eligible: true,
        reason: "",
        candidate: body.candidate,
        nextClipId: body.nextClipId
      });
    }).catch((error: any) => {
      if (error?.name === "AbortError") return;
      setPreflight({
        key,
        loading: false,
        eligible: false,
        reason: String(error?.message || error || "Continuity preflight failed."),
        candidate: null,
        nextClipId: null
      });
    });
    return () => controller.abort();
  }, [projectSlug, clipId, nextClipId, requestKey]);

  const promote = async () => {
    if (!projectSlug || !clipId || busy || preflight.key !== requestKey || !preflight.eligible) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/continuity/promote-last-frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId,
          takeVersion: preflight.candidate?.selector,
          ...(nextClipId ? { nextClipId } : {})
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Promote last frame failed (${response.status}).`);
      if (body.project?.slug !== projectSlug || !responseContainsAppliedEvidence(body)) {
        throw new Error("The server returned incomplete or unverified continuity state; no success was applied.");
      }
      if (useStore.getState().project?.slug !== projectSlug) {
        throw new Error("The open project changed before continuity state could be applied.");
      }
      const nextState: { project: any; storyboard?: any } = { project: body.project };
      if (Object.hasOwn(body, "storyboard")) nextState.storyboard = body.storyboard;
      useStore.setState(nextState);
      const next = body.nextClipId || "next shot";
      const count = Array.isArray(body.bindings) ? body.bindings.length : 0;
      setNotice({
        kind: "success",
        text: `Last decoded frame attached as ${next} first guide · ${count} identity/wardrobe binding${count === 1 ? "" : "s"}.`
      });
    } catch (error: any) {
      setNotice({ kind: "error", text: String(error.message || error) });
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
        disabled={busy || !clipId || !projectSlug || preflight.key !== requestKey || preflight.loading || !preflight.eligible}
        onClick={() => void promote()}
      >
        {busy
          ? "Extracting last frame…"
          : preflight.loading || preflight.key !== requestKey
            ? "Checking continuity…"
            : preflight.eligible
              ? "Use last frame as next first guide"
              : "Continuity unavailable"}
      </button>
      {!preflight.loading && preflight.key === requestKey && !preflight.eligible ? (
        <small className="storyboard-global-notice" role="status" aria-live="polite">
          {preflight.reason}
        </small>
      ) : null}
      {notice ? (
        <small
          className={`storyboard-global-notice ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {notice.text}
        </small>
      ) : null}
    </div>
  );
}
