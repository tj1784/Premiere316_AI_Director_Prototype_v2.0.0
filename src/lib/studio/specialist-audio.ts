import type { ImportedAudioProbe } from "../desktop/protocol.ts";
import type { AudioWorkspace } from "../production/audio-types.ts";
import { recordImportedAudioTake } from "../production/audio-iterations.ts";

export type SpecialistEngine = "ace-step-1.5-xl-sft" | "stable-audio-3-small-sfx";
export type SpecialistJob = {
  id: string;
  pictureId: string;
  cueId: string;
  cueSnapshot: string;
  request: { engineId: SpecialistEngine; duration: number; seed: number; prompt: string };
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  createdAt: number;
  error: string | null;
  output: null | {
    mediaUri: string;
    mediaSha256: string;
    byteLength: number;
    probe: ImportedAudioProbe;
    engineId: SpecialistEngine;
    provenance: unknown;
  };
};
export type SpecialistInput =
  | { operation: "configure"; engineId: SpecialistEngine }
  | { operation: "status"; pictureId: string }
  | { operation: "cancel"; jobId: string }
  | {
      operation: "start";
      pictureId: string;
      cueId: string;
      cueSnapshot: string;
      engineId: SpecialistEngine;
      seed: number;
    };
export type SpecialistResult =
  | { ok: false; error: string }
  | { ok: true; configured?: string[]; jobs?: SpecialistJob[]; job?: SpecialistJob; note?: string };

export function acceptSpecialistCandidate(
  workspace: AudioWorkspace,
  pictureId: string,
  job: SpecialistJob,
): AudioWorkspace {
  if (job.pictureId !== pictureId || job.status !== "completed" || !job.output?.probe.ok)
    throw new Error("A completed, probed job for this picture is required.");
  const cue = workspace.cues.find((c) => c.id === job.cueId);
  if (!cue || JSON.stringify(cue) !== job.cueSnapshot)
    throw new Error(
      "Cue changed since generation. Retain this output as history; generate against the current cue explicitly.",
    );
  if (workspace.takes.some((t) => t.jobId === job.id)) return workspace;
  if (job.output.engineId !== job.request.engineId || !job.output.provenance)
    throw new Error("Specialist output lacks matching provenance.");
  const recorded = recordImportedAudioTake(workspace, {
    pictureId,
    cueId: cue.id,
    shotId: cue.shotId,
    kind: cue.kind,
    filename: `${job.id}.wav`,
    mediaUri: job.output.mediaUri,
    mediaSha256: job.output.mediaSha256,
    byteLength: job.output.byteLength,
    durationSec: job.output.probe.durationSec ?? 0,
    channels: job.output.probe.channels,
    sampleRate: job.output.probe.sampleRate,
    format: job.output.probe.codec,
  });
  const take = recorded.takes.at(-1)!;
  return {
    ...recorded,
    takes: [
      ...recorded.takes.slice(0, -1),
      {
        ...take,
        origin: "native-generated",
        engineId: job.request.engineId,
        jobId: job.id,
        generationProvenance: job.output.provenance,
      },
    ],
    jobs: [
      ...recorded.jobs,
      {
        id: job.id,
        pictureId,
        cueId: cue.id,
        lineId: null,
        kind: cue.kind,
        engineId: job.request.engineId,
        status: "completed",
        createdAt: job.createdAt,
        updatedAt: Date.now(),
        takeIds: [take.id],
        error: null,
      },
    ],
  };
}
