import "./sound-workbench.css";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { hydratePictureAudio, recordImportedAudioTake } from "@/lib/production/audio-iterations";
import type { SoundCueRecord } from "@/lib/production/audio-types";
import { stableHash } from "@/lib/production/dependency-graph";
import { hasVocalIntent, soundCueSaveError } from "@/lib/production/sound-cue-policy";
import { desktopImportAudio } from "@/lib/desktop/client";
import { uid } from "@/lib/utils";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { SpecialistAudioPanel } from "./specialist-audio-panel";

export function SoundCueEditor() {
  const picture = useActivePicture();
  const patch = useStudio((s) => s.patchActive);
  const [draft, setDraft] = useWorkspaceDraft<SoundCueRecord | null>("sound-cue", null);
  const [selectedCueId, setSelectedCueId] = useWorkspaceDraft("selected-sound-cue", "");
  const [surface, setSurface] = useWorkspaceDraft("sound-cue-surface", "direction");
  const [legacyCueId, setLegacyCueId] = useWorkspaceDraft("legacy-sound-cue", "");
  if (!picture) return null;
  const audio = hydratePictureAudio(picture);
  const field = (
    key:
      | "name"
      | "notes"
      | "instrumentation"
      | "perspective"
      | "mixPriority"
      | "syncLandmarks"
      | "vocalPolicy"
      | "transition"
      | "destination",
    label: string,
  ) => (
    <label className="grid gap-1 text-sm">
      {label}
      <Textarea
        value={draft?.[key] ?? ""}
        onChange={(e) => setDraft(draft ? { ...draft, [key]: e.target.value } : null)}
      />
    </label>
  );
  return (
    <section className="sound-workbench">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl">Sound & musical development</h2>
          <p className="mt-1 text-sm text-muted">
            Source-bound cues, not generated audio. Auditioned takes require separate approval.
          </p>
        </div>
        <Button
          onClick={() =>
            setDraft({
              id: uid("cue"),
              name: "New cue",
              kind: "score",
              startSec: 0,
              durationSec: 10,
              sceneId: null,
              shotId: null,
              notes: "",
              instrumentation: "",
            })
          }
        >
          Add cue
        </Button>
      </header>
      <div className="sound-workbench-body"><aside className="sound-cue-rail" aria-label="Sound cues">
        {audio.cues.map((cue) => <button key={cue.id} aria-pressed={(selectedCueId || audio.cues[0]?.id) === cue.id} onClick={() => { setSelectedCueId(cue.id); setLegacyCueId(""); setDraft(null); setSurface("direction"); }}><span>{cue.name}</span><small>{cue.kind} · {cue.startSec}s</small></button>)}
        {picture.cues.filter((cue) => !audio.cues.some((authored) => authored.id === cue.id)).map((cue) => <button key={cue.id} aria-pressed={legacyCueId === cue.id} onClick={() => { setLegacyCueId(cue.id); setSelectedCueId(""); setDraft(null); setSurface("direction"); }}><span>{cue.name}</span><small>Source score · {cue.startSec}s</small></button>)}
        {!audio.cues.length && !picture.cues.length && <p>No cues yet. Add a cue to define the soundtrack.</p>}
      </aside><div className="sound-workbench-main">
      <div className="workspace-tabs mb-4" aria-label="Cue work">
        <button aria-pressed={surface === "direction"} onClick={() => setSurface("direction")}>Direction & takes</button>
        <button aria-pressed={surface === "specialists"} onClick={() => setSurface("specialists")}>Specialist audio</button>
      </div>
      {surface === "direction" && draft && (
        <div className="grid gap-3 rounded border border-border bg-inset p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("name", "Cue name")}
            <label className="grid gap-1 text-sm">
              Kind
              <select
                className="min-h-11 rounded border border-border bg-surface px-3"
                value={draft.kind}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as SoundCueRecord["kind"] })
                }
              >
                {[
                  "dialogue",
                  "foley",
                  "ambience",
                  "room-tone",
                  "impact",
                  "creature",
                  "environment",
                  "transition",
                  "score",
                  "silence",
                ].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Source scene
              <select
                className="min-h-11 w-full rounded border border-border bg-surface"
                value={draft.sceneId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, sceneId: e.target.value || null, shotId: null })
                }
              >
                <option value="">Film-wide cue</option>
                {picture.scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.slugline}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Source shot
              <select
                className="min-h-11 w-full rounded border border-border bg-surface"
                value={draft.shotId ?? ""}
                onChange={(e) => setDraft({ ...draft, shotId: e.target.value || null })}
              >
                <option value="">No individual shot</option>
                {picture.shots
                  .filter((s) => !draft.sceneId || s.sceneId === draft.sceneId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["startSec", "durationSec", "tailSec"] as const).map((key) => (
              <label key={key} className="text-sm">
                {key === "startSec"
                  ? "Timeline start (seconds)"
                  : key === "durationSec"
                    ? "Duration (seconds)"
                    : "Tail (seconds)"}
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft[key] ?? 0}
                  onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          {field(
            "notes",
            draft.kind === "silence"
              ? "Reason for intentional silence"
              : "Narrative function / full cue description",
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("perspective", "Spatial perspective / distance / material")}
            {field("mixPriority", "Mix priority")}
            {field("syncLandmarks", "Sync landmarks / onset / envelope")}
            {field("instrumentation", "Instrumentation")}
            {field("vocalPolicy", "Vocal policy (e.g. wordless choir, no intelligible lyrics)")}
            {field("transition", "Entry / exit / transition")}
          </div>
          {draft.kind === "score" && (
            <fieldset className="grid gap-3 rounded border border-border p-3 sm:grid-cols-2">
              <legend className="px-2 text-sm">Concrete motif specification</legend>
              {(
                ["pitches", "rhythm", "register", "tempo", "development", "referenceId"] as const
              ).map((key) => (
                <label key={key} className="text-sm capitalize">
                  {key}
                  <Input
                    value={draft.motif?.[key] ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        motif: {
                          pitches: "",
                          rhythm: "",
                          register: "",
                          tempo: "",
                          development: "",
                          referenceId: "",
                          ...draft.motif,
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </fieldset>
          )}
          {field("destination", "Destination / format / execution notes")}
          {hasVocalIntent(draft) && (
            <p className="text-xs text-muted">
              New dialogue and vocal cues need a shot in an approved screenplay scene and an
              authored sound permission with its source in the scene or shot Bible.
            </p>
          )}
          <p className="text-xs text-muted">
            Specialist targets: ACE-Step 1.5 XL SFT (score), Stable Audio 3 Small-SFX (effects).
            Installed adapter and exact variant must be verified; no Medium/Turbo substitution. Text
            alone cannot establish repeated melodic identity or sample-accurate sync.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                if (
                  !draft.name.trim() ||
                  !draft.notes.trim() ||
                  !Number.isFinite(draft.startSec) ||
                  draft.startSec < 0 ||
                  !Number.isFinite(draft.durationSec) ||
                  draft.durationSec <= 0 ||
                  !Number.isFinite(draft.tailSec ?? 0) ||
                  (draft.tailSec ?? 0) < 0
                ) {
                  toast.error("Name, description and valid timing are required.");
                  return;
                }
                const evidenceError = soundCueSaveError(
                  picture,
                  draft,
                  audio.cues.find((item) => item.id === draft.id) ?? null,
                );
                if (evidenceError) {
                  toast.error(evidenceError);
                  return;
                }
                const cue = {
                  ...draft,
                  revision: (draft.revision ?? 0) + 1,
                  sourceHash: stableHash({
                    screenplay: picture.screenplay.approvedVersionId,
                    scene: picture.scenes.find((s) => s.id === draft.sceneId),
                    shot: picture.shots.find((s) => s.id === draft.shotId),
                    sceneSound: draft.sceneId ? picture.movieBible?.records[draft.sceneId] : null,
                    shotSound: draft.shotId ? picture.movieBible?.records[draft.shotId] : null,
                  }),
                };
                patch({
                  audio: {
                    ...audio,
                    cues: [...audio.cues.filter((c) => c.id !== cue.id), cue],
                    takes: audio.takes.map((t) =>
                      t.cueId === cue.id
                        ? {
                            ...t,
                            canonical: false,
                            status: "NEEDS_REVIEW" as const,
                            reviewReason: "Cue revised; previous listening approval is stale.",
                          }
                        : t,
                    ),
                  },
                });
                setDraft(null);
              }}
            >
              Save cue
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {surface === "specialists" && <SpecialistAudioPanel key={picture.id} picture={picture} />}
      {surface === "direction" && !draft && picture.cues.length && (legacyCueId || !audio.cues.length) ? (() => { const cue = picture.cues.find((item) => item.id === legacyCueId) ?? picture.cues[0]; return <article className="sound-source-cue"><p className="text-xs text-muted">Source cue · {cue.id}</p><h3>{cue.name}</h3><p>{cue.startSec}s · {cue.durationSec}s · {cue.mood}</p><p>Instruments: {cue.instruments || "Not authored"}</p><p>Sound: {cue.sfx || "Not authored"}</p><p className="whitespace-pre-wrap">{cue.minimaxPrompt}</p><Button variant="secondary" onClick={() => setDraft({ id: cue.id, name: cue.name, kind: "score", startSec: cue.startSec, durationSec: cue.durationSec, sceneId: null, shotId: null, notes: cue.mood || cue.minimaxPrompt, instrumentation: cue.instruments })}>Develop this cue</Button></article>; })() : null}
      {surface === "direction" && !draft && !legacyCueId && audio.cues.filter((c) => c.id === (selectedCueId || audio.cues[0]?.id)).map((c) => (
        <article key={c.id} className="rounded border border-border p-3">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <h3 className="text-lg">{c.name}</h3>
              <p className="text-xs text-muted">
                {c.kind} · {c.startSec}s + {c.durationSec}s · {c.sceneId ?? "film"}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setDraft(structuredClone(c))}>
              Edit cue
            </Button>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{c.notes}</p>
          {c.kind !== "silence" && (
            <Button
              className="mt-3"
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  const imported = await desktopImportAudio();
                  if (!imported.ok) {
                    if (!imported.canceled) toast.error(imported.error);
                    return;
                  }
                  const latest = useStudio.getState().pictures.find((p) => p.id === picture.id);
                  if (!latest) return;
                  const currentCue = hydratePictureAudio(latest).cues.find(
                    (item) => item.id === c.id,
                  );
                  if (!currentCue || stableHash(currentCue) !== stableHash(c))
                    throw new Error(
                      "Cue changed while the import dialog was open. Reopen import from the current cue.",
                    );
                  const workspace = recordImportedAudioTake(hydratePictureAudio(latest), {
                    pictureId: picture.id,
                    kind: c.kind,
                    filename: imported.filename,
                    mediaUri: imported.mediaUri,
                    mediaSha256: imported.mediaSha256,
                    byteLength: imported.byteLength,
                    durationSec: imported.probe.durationSec ?? 0,
                    sampleRate: imported.probe.sampleRate,
                    channels: imported.probe.channels,
                    format: imported.probe.codec,
                    cueId: c.id,
                    shotId: c.shotId,
                  });
                  useStudio.getState().replaceActive({ ...latest, audio: workspace });
                  toast.success("Cue take imported — awaiting listening review.");
                } catch (error) {
                  toast.error(String(error));
                }
              }}
            >
              Import take for this cue
            </Button>
          )}
        </article>
      ))}
      </div></div>
    </section>
  );
}
