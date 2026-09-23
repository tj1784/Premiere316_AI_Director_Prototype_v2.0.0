import { useEffect } from "react";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import {
  continuityIssues,
  continuityParticipants,
  saveShotContinuity,
  type ShotContinuity,
  type ParticipantContinuity,
} from "@/lib/studio/shot-continuity";
import { toast } from "sonner";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { ContinuityImageInspector } from "./continuity-image-inspector";
export function ShotContinuityEditor() {
  const picture = useActivePicture();
  const patch = useStudio((s) => s.patchActive);
  const [draft, setDraft] = useWorkspaceDraft<ShotContinuity | null>("shot-continuity", null);
  useEffect(() => {
    if (!picture || draft || !picture.shots[0]) return;
    const first = picture.shots[0];
    setDraft(structuredClone(picture.shotContinuity?.[first.id] ?? {
      id: "", shotId: first.id, revision: 0, predecessorId: null,
      source: "User direction", cameraPosition: { x: 0, y: 1.6, z: 5 },
      cameraTarget: { x: 0, y: 1.6, z: 0 }, participants: [],
      completedEvents: [], newEvents: [], restartReason: "",
      imageDisposition: "uninspected", imageHash: "", inspectionReason: "",
    }));
  }, [picture, draft, setDraft]);
  if (!picture) return null;
  const shot = picture.shots.find((s) => s.id === draft?.shotId);
  const updateParticipant = (index: number, change: Partial<ParticipantContinuity>) =>
    setDraft(
      draft
        ? {
            ...draft,
            participants: draft.participants.map((p, i) => (i === index ? { ...p, ...change } : p)),
          }
        : null,
    );
  return (
    <section className="my-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-2xl">Geography & continuity</h2>
      <p className="my-2 text-sm text-muted">
        Physical state, individual tasks and completed events are separate from emotional direction.
        Coordinates use metres.
      </p>
      <label className="grid gap-2 text-sm">
        Shot
        <select
          className="min-h-11 rounded bg-inset p-2"
          value={draft?.shotId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            setDraft(
              id
                ? structuredClone(
                    picture.shotContinuity?.[id] ?? {
                      id: "",
                      shotId: id,
                      revision: 0,
                      predecessorId: null,
                      source: "User direction",
                      cameraPosition: { x: 0, y: 1.6, z: 5 },
                      cameraTarget: { x: 0, y: 1.6, z: 0 },
                      participants: [],
                      completedEvents: [],
                      newEvents: [],
                      restartReason: "",
                      imageDisposition: "uninspected",
                      imageHash: "",
                      inspectionReason: "",
                    },
                  )
                : null,
            );
          }}
        >
          <option value="">Select shot…</option>
          {picture.shots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.index} · {s.description}
            </option>
          ))}
        </select>
      </label>
      {draft && shot && (
        <div className="mt-4 grid gap-3">
          {(["cameraPosition", "cameraTarget"] as const).map((key) => (
            <fieldset key={key}>
              <legend>
                {key === "cameraPosition" ? "Camera position (metres)" : "Camera target (metres)"}
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {(["x", "y", "z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <Input
                      type="number"
                      step="0.1"
                      value={draft[key][axis]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [key]: { ...draft[key], [axis]: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <label className="grid gap-1 text-sm">
            Predecessor
            <select
              className="min-h-11 rounded bg-inset p-2"
              value={draft.predecessorId ?? ""}
              onChange={(e) => {
                const prior = picture.shotContinuity?.[e.target.value];
                setDraft({
                  ...draft,
                  predecessorId: e.target.value || null,
                  participants: prior
                    ? prior.participants.map((p) => ({
                        ...p,
                        incoming: p.outgoing,
                        position: { ...p.endPosition },
                      }))
                    : draft.participants,
                  completedEvents: prior
                    ? [...new Set([...prior.completedEvents, ...prior.newEvents])]
                    : draft.completedEvents,
                });
              }}
            >
              <option value="">Authored onset</option>
              {picture.shots
                .filter((s) => s.id !== shot.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.index} · {s.id}
                  </option>
                ))}
            </select>
          </label>
          {draft.participants.map((p, i) => (
            <fieldset
              key={p.characterId}
              className="grid gap-3 rounded border border-border p-3 sm:grid-cols-2"
            >
              <legend>
                {continuityParticipants(picture).find((c) => c.id === p.characterId)?.name ??
                  p.characterId}
              </legend>
              {(
                [
                  "incoming",
                  "outgoing",
                  "knowledge",
                  "objective",
                  "permittedSound",
                  "support",
                  "contact",
                  "supportLimb",
                  "actionLimb",
                  "transferReason",
                ] as const
              ).map((key) => (
                <label key={key} className="grid gap-1 text-sm">
                  {key}
                  <Textarea
                    value={p[key] ?? ""}
                    onChange={(e) => updateParticipant(i, { [key]: e.target.value })}
                  />
                </label>
              ))}
              {(["position", "endPosition"] as const).map((key) => (
                <fieldset key={key}>
                  <legend className="text-sm">{key}</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <label key={axis} className="text-xs">
                        {axis}
                        <Input
                          type="number"
                          step="0.1"
                          value={p[key][axis]}
                          onChange={(e) =>
                            updateParticipant(i, {
                              [key]: { ...p[key], [axis]: Number(e.target.value) },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <label className="text-sm">
                Maximum travel speed (m/s)
                <Input
                  type="number"
                  min={0}
                  value={p.maxSpeed}
                  onChange={(e) => updateParticipant(i, { maxSpeed: Number(e.target.value) })}
                />
              </label>
            </fieldset>
          ))}
          <label className="text-sm">
            Add individual participant
            <select
              className="block min-h-11 w-full rounded bg-inset p-2"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                setDraft({
                  ...draft,
                  participants: [
                    ...draft.participants,
                    {
                      characterId: e.target.value,
                      incoming: "",
                      outgoing: "",
                      knowledge: "",
                      objective: "",
                      permittedSound: "",
                      position: { x: 0, y: 0, z: 0 },
                      endPosition: { x: 0, y: 0, z: 0 },
                      maxSpeed: 1.4,
                      support: "",
                      contact: "",
                    },
                  ],
                });
              }}
            >
              <option value="">Choose character…</option>
              {continuityParticipants(picture)
                .filter((c) => !draft.participants.some((p) => p.characterId === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          {(["completedEvents", "newEvents"] as const).map((key) => (
            <label key={key} className="text-sm">
              {key} (one exact event per line)
              <Textarea
                value={draft[key].join("\n")}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: e.target.value.split("\n").filter(Boolean) })
                }
              />
            </label>
          ))}
          <label className="text-sm">
            Explicit state change / restart reason
            <Textarea
              value={draft.restartReason}
              onChange={(e) => setDraft({ ...draft, restartReason: e.target.value })}
            />
          </label>
          <p className="text-xs text-muted">
            Starting media: {draft.imageDisposition}. Text edits do not certify image consistency;
            media review remains required.
          </p>
          <ContinuityImageInspector key={draft.shotId} picture={picture} draft={draft} onChange={setDraft} />
          {continuityIssues(picture, shot, draft).map((issue) => (
            <p key={issue} role="status" className="text-sm text-rec">
              {issue}
            </p>
          ))}
          <Button
            onClick={() => {
              try {
                patch({ shotContinuity: saveShotContinuity(picture, draft) });
                toast.success("Continuity draft saved. Unresolved issues block compilation.");
              } catch (e) {
                toast.error(String(e));
              }
            }}
          >
            Save continuity
          </Button>
        </div>
      )}
    </section>
  );
}
