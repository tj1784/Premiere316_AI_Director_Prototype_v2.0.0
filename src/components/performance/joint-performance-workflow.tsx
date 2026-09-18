import {
  createReviewGuard,
  jointReviewFingerprint,
  type ReviewTicket,
} from "@/lib/emotion/review-guard";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Picture } from "@/lib/studio/types";
import { useStudio } from "@/lib/studio/store";
import { exportVoiceReferences } from "@/lib/studio/voice-reference";
import { isPerformanceDraftStale, type PerformanceDraft } from "@/lib/emotion/integration";
import {
  reviewJointWorkflow,
  runJointWorkflow,
  jointJobStatus,
  type JointReviewInput,
} from "@/lib/emotion/joint-api";
import type { ApiWorkflow } from "@/lib/emotion/joint-generation";
import type { DirectorReviewResult } from "@/lib/studio/director-execution";

async function mediaData(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Approved reference media cannot be read.");
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Reference media could not be opened."));
    reader.readAsDataURL(blob);
  });
}
export function JointPerformanceWorkflow({
  picture,
  draft,
}: {
  picture: Picture;
  draft: PerformanceDraft;
}) {
  const [workflow, setWorkflow] = useState(""),
    [lines, setLines] = useState<string[]>([]),
    [bindings, setBindings] = useState<Record<string, string>>({}),
    [review, setReview] = useState<DirectorReviewResult | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [job, setJob] = useState<string | null>(
      picture.directorRenderJobs?.[`cueboard:${draft.id}`]?.promptId ?? null,
    ),
    [outputs, setOutputs] = useState<Array<{ filename: string; url: string }>>([]);
  const manifest = exportVoiceReferences(picture),
    speakers = [
      ...new Set(
        draft.compiled.filter((l) => lines.includes(l.line_id)).map((l) => l.character_id),
      ),
    ];
  const current =
    picture.emotionPerformance?.applied[draft.sceneId] === draft.id &&
    !isPerformanceDraftStale(picture, draft);
  const guard = useRef(createReviewGuard());
  const accepted = useRef<ReviewTicket | null>(null);
  const readFingerprint = useRef<() => string>(() => "");
  readFingerprint.current = () => {
    const latest = useStudio.getState().pictures.find((p) => p.id === picture.id);
    if (!latest) return "missing-picture";
    try {
      return jointReviewFingerprint({ picture: latest, draft, workflow, lines, bindings });
    } catch {
      return "invalid-source";
    }
  };
  useEffect(() => () => guard.current.invalidate(), []);
  const reviewCurrent = guard.current.matches(accepted.current, readFingerprint.current());
  const invalidate = () => {
    guard.current.invalidate();
    accepted.current = null;
    setReview(null);
    setJob(null);
  };
  async function inspect() {
    const ticket = guard.current.begin(readFingerprint.current());
    accepted.current = null;
    setBusy(true);
    setMessage("");
    setReview(null);
    try {
      const graph = JSON.parse(workflow) as ApiWorkflow;
      if (
        !graph ||
        Array.isArray(graph) ||
        Object.values(graph).some((n) => !n?.class_type || !n.inputs)
      )
        throw new Error(
          "Import the API-format workflow from ComfyUI. A visual graph or Director timeline is not this adapter.",
        );
      const refs = Object.entries(graph).filter(
        ([, n]) => n.class_type === "MiniMaxH3ReferenceToVideo",
      );
      if (refs.length !== 1)
        throw new Error(
          "Unsupported: select a direct H3 Ref2VA workflow. FL2VA and LTX supplied audio cannot provide voice identity here.",
        );
      const [conditioningNodeId, node] = refs[0];
      if (typeof node.inputs.prompt !== "string")
        throw new Error(
          "The Ref2VA prompt is connected upstream. Review and explicitly make it a local text input before applying performance.",
        );
      const references: JointReviewInput["references"] = [];
      for (const speaker of speakers) {
        const selected = manifest.references.find((r) => r.binding === bindings[speaker]);
        if (!selected) throw new Error("Explicitly assign an approved voice to each speaker.");
        const asset = picture.production?.assets.find(
            (a) => a.id === selected.characterId && !a.tombstone,
          ),
          image = asset?.iterations.find(
            (i) => i.id === asset.approvedIterationId && i.status === "APPROVED",
          );
        if (!image?.mediaSha256 || !selected.reference.audio?.sha256)
          throw new Error("This speaker needs a hash-verified approved image and voice.");
        const audioNodeId = `p316_voice_${references.length}`,
          imageNodeId = `p316_image_${references.length}`;
        if (graph[audioNodeId] || graph[imageNodeId])
          throw new Error("Reserved reference node IDs already exist. Review the imported graph.");
        graph[audioNodeId] = {
          class_type: "LoadAudio",
          inputs: { audio: selected.reference.audio.filename },
        };
        graph[imageNodeId] = {
          class_type: "LoadImage",
          inputs: { image: "approved-reference.png" },
        };
        const [imageData, audioData] = await Promise.all([
          mediaData(image.previewUri ?? image.mediaUri),
          mediaData(selected.reference.audio.previewUri ?? selected.reference.audio.mediaUri),
        ]);
        references.push({
          speaker,
          binding: selected.binding,
          audioNodeId,
          imageNodeId,
          imageSha256: image.mediaSha256,
          audioSha256: selected.reference.audio.sha256,
          imageIterationId: image.id,
          imageData,
          audioData,
        });
      }
      if (!guard.current.matches(ticket, readFingerprint.current())) return;
      const result = await reviewJointWorkflow({
        data: {
          pictureId: picture.id,
          draftId: draft.id,
          lineIds: lines,
          workflow: graph,
          conditioningNodeId,
          basePrompt: node.inputs.prompt,
          references,
        },
      });
      if (!guard.current.matches(ticket, readFingerprint.current())) return;
      accepted.current = ticket;
      setReview(result);
      setMessage(
        result.ok
          ? result.runtimeAvailable
            ? result.issues.length
              ? result.issues.join(" ")
              : "Live workflow checks passed. Review the dialogue, speaker assignments and unchanged model settings before approving one clip."
            : "H3 runtime is offline. Generation is blocked until the installed Ref2VA workflow can be verified."
          : result.error,
      );
    } catch (e) {
      if (guard.current.matches(ticket, readFingerprint.current()))
        setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (
      !current ||
      !review?.ok ||
      !review.runtimeAvailable ||
      review.issues.length ||
      !guard.current.matches(accepted.current, readFingerprint.current())
    ) {
      invalidate();
      setMessage("Inputs changed. Review the current workflow again before generation.");
      return;
    }
    setBusy(true);
    try {
      const result = await runJointWorkflow({
        data: { pictureId: picture.id, reviewId: review.reviewId },
      });
      if (result.ok || result.promptId) {
        setJob(result.promptId!);
        const store = useStudio.getState(),
          p = store.pictures.find((p) => p.id === picture.id);
        if (p)
          store.replaceActive({
            ...p,
            updatedAt: Date.now(),
            directorRenderJobs: {
              ...p.directorRenderJobs,
              [`cueboard:${draft.id}`]: {
                promptId: result.promptId!,
                submittedAt: Date.now(),
                uncertain: !result.ok,
              },
            },
          });
      }
      setMessage(result.ok ? "Joint speech/video clip queued." : result.error);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded border border-border p-3">
      <summary className="cursor-pointer text-sm">Joint speech/video · H3 workflow review</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted">
          Direct H3 Ref2VA only. LTX supplied audio and H3 FL2VA are unsupported for
          voice-identity-only generation. Import an API workflow with its intended model, seed,
          sampling, camera and scene prompt. Existing reference connections must be reviewed and
          cleared explicitly before assigning new ones.
        </p>
        <label className="block text-xs">
          API workflow JSON
          <input
            type="file"
            accept=".json,application/json"
            className="mt-2 block min-h-11 w-full"
            onChange={(e) => {
              const f = e.target.files?.[0];
              invalidate();
              const fileTicket = guard.current.begin(readFingerprint.current());
              if (f)
                void f
                  .text()
                  .then((t) => {
                    if (!guard.current.matches(fileTicket, readFingerprint.current())) return;
                    setWorkflow(t);
                    invalidate();
                  })
                  .catch((e) => setMessage(String(e)));
            }}
          />
          <textarea
            aria-label="H3 API workflow JSON"
            className="min-h-32 w-full rounded border border-border bg-inset p-2 font-mono text-xs"
            value={workflow}
            onChange={(e) => {
              setWorkflow(e.target.value);
              invalidate();
            }}
          />
        </label>
        <p className="text-xs text-muted">Select dialogue for one bounded clip:</p>
        {draft.compiled.map((l) => (
          <label key={l.line_id} className="flex min-h-11 items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={lines.includes(l.line_id)}
              onChange={(e) => {
                setLines((ids) =>
                  e.target.checked ? [...ids, l.line_id] : ids.filter((id) => id !== l.line_id),
                );
                invalidate();
              }}
            />
            <span>
              {draft.config.character_baselines[l.character_id].label}:{" "}
              {l.spoken_text || "(silent reaction)"}
            </span>
          </label>
        ))}
        {speakers.map((speaker) => (
          <label key={speaker} className="block text-xs">
            {draft.config.character_baselines[speaker].label} — approved character/member reference
            <select
              aria-label={`Voice reference for ${draft.config.character_baselines[speaker].label}`}
              className="mt-1 min-h-11 w-full rounded border border-border bg-inset px-2"
              value={bindings[speaker] ?? ""}
              onChange={(e) => {
                setBindings((b) => ({ ...b, [speaker]: e.target.value }));
                invalidate();
              }}
            >
              <option value="">Choose explicitly</option>
              {manifest.references.map((r) => (
                <option key={r.binding} value={r.binding}>
                  {r.reference.name} · {r.reference.memberLabel ?? r.characterId}
                </option>
              ))}
            </select>
          </label>
        ))}
        {!current && (
          <p role="status" className="text-xs text-accent">
            Apply a current performance draft first.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || !current || !lines.length || !workflow}
            onClick={() => void inspect()}
          >
            Review live workflow
          </Button>
          <Button
            size="sm"
            disabled={
              busy ||
              !current ||
              !review?.ok ||
              !reviewCurrent ||
              !review.runtimeAvailable ||
              !!review.issues.length ||
              !!job
            }
            onClick={() => void generate()}
          >
            Approve and generate one clip
          </Button>
          {job && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void jointJobStatus({ data: { pictureId: picture.id, promptId: job } })
                  .then((result) => {
                    setMessage(result.ok ? `${result.status}: ${result.message}` : result.error);
                    if (result.ok) setOutputs(result.outputs);
                  })
                  .catch((e) => setMessage(String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Check clip status
            </Button>
          )}
        </div>
        {outputs.map((output) => (
          <div key={output.url} className="space-y-2">
            <video controls preload="metadata" className="max-h-80 w-full" src={output.url} />
            <a className="text-xs underline" href={output.url} download={output.filename}>
              Download {output.filename}
            </a>
            <p className="text-xs text-muted">
              Saved in this picture’s project folder. Awaiting your review.
            </p>
          </div>
        ))}
        {message && (
          <p role="status" className="whitespace-pre-wrap text-xs text-accent">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
