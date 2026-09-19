import { createHash } from "node:crypto";
import { join } from "node:path";
import { createDirectorExecutionService } from "../../../desktop/director-execution.mjs";
import { compileJointWorkflow } from "../../../desktop/joint-workflow.mjs";
import { projectLibraryService } from "../studio/project-library.server";
import { exportVoiceReferences } from "../studio/voice-reference";
import type { Picture } from "../studio/types";
import { isPerformanceDraftStale } from "./integration";
import { mapJointPerformanceRequest } from "./joint-generation";
import type { JointReviewInput } from "./joint-api";
const endpoint = "http://127.0.0.1:8191"; // Installed MiniMax_H3 instance; never switch the LTX instance/model.
const services = new Map<string, ReturnType<typeof createDirectorExecutionService>>();
const archived = new Map<string, string>();
const monitors = new Set<string>();
function picture(id: string): Picture {
  if (process.env.VERCEL) throw new Error("Joint generation requires the local project runtime.");
  const state = JSON.parse(projectLibraryService().readState(null));
  const result = state.state.pictures.find((p: Picture) => p.id === id);
  if (!result) throw new Error("Save this picture to its project folder first.");
  return result;
}
function validateCurrent(input: JointReviewInput) {
  const p = picture(input.pictureId),
    draft = p.emotionPerformance?.drafts.find((d) => d.id === input.draftId);
  if (
    !draft ||
    p.emotionPerformance?.applied[draft.sceneId] !== draft.id ||
    isPerformanceDraftStale(p, draft)
  )
    throw new Error("Apply a current performance draft before workflow review.");
  const manifest = exportVoiceReferences(p);
  for (const ref of input.references) {
    const voice = manifest.references.find((r) => r.binding === ref.binding);
    const asset = p.production?.assets.find((a) => a.id === voice?.characterId && !a.tombstone);
    const image = asset?.iterations.find(
      (i) =>
        i.id === ref.imageIterationId &&
        i.id === asset.approvedIterationId &&
        i.status === "APPROVED",
    );
    if (!image || image.mediaSha256 !== ref.imageSha256)
      throw new Error("Use the approved image for the explicitly assigned speaker.");
  }
  return mapJointPerformanceRequest({ mode: "h3-ref2va", ...input, draft, manifest });
}
type Wrapped = {
  nodes: Array<{ id: string }>;
  joint: { prompt: JointReviewInput["workflow"]; input: JointReviewInput };
};
function service(id: string) {
  if (services.has(id)) return services.get(id)!;
  const p = picture(id),
    slug = p.projectLibrary?.slug;
  if (!slug || !/^[a-z0-9_]+$/.test(slug))
    throw new Error("Picture project folder is unavailable.");
  const instance = createDirectorExecutionService({
    endpoint,
    directory: join(
      process.env.PREMIERE316_PROJECT_ROOT || process.cwd(),
      "projects",
      slug,
      "jobs",
      "joint-video",
    ),
    compile: compileJointWorkflow,
    ensureHost: async () => {
      const r = await fetch(`${endpoint}/system_stats`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok)
        throw new Error("The installed H3 instance is unavailable. No other runtime was started.");
    },
    openWorkflow: async () => false,
    prepareWorkflow: async (
      workflow: Wrapped,
      fetchLocal: (path: string, options?: RequestInit) => Promise<Response>,
    ) => {
      validateCurrent(workflow.joint.input);
      for (const ref of workflow.joint.input.references)
        for (const kind of ["image", "audio"] as const) {
          const data = kind === "image" ? ref.imageData : ref.audioData,
            sha = kind === "image" ? ref.imageSha256 : ref.audioSha256,
            nodeId = kind === "image" ? ref.imageNodeId : ref.audioNodeId;
          const match =
            /^data:(image\/(?:png|jpeg|webp)|audio\/(?:wav|x-wav|flac|mpeg|ogg));base64,([A-Za-z0-9+/=]+)$/.exec(
              data,
            );
          if (!match) throw new Error("Reference media format is unsupported.");
          const bytes = Buffer.from(match[2], "base64");
          if (createHash("sha256").update(bytes).digest("hex") !== sha)
            throw new Error("Reference bytes changed after approval.");
          const ext = match[1].split("/")[1].replace("x-wav", "wav").replace("jpeg", "jpg");
          const name = `p316_${sha}.${ext}`,
            subfolder = "premiere316/identity";
          const view = `/view?${new URLSearchParams({ filename: name, subfolder, type: "input" })}`;
          let existing = await fetchLocal(view);
          if (existing.status === 404) {
            const form = new FormData();
            form.append("image", new Blob([bytes], { type: match[1] }), name);
            form.append("subfolder", subfolder);
            form.append("type", "input");
            form.append("overwrite", "false");
            const uploaded = await fetchLocal("/upload/image", { method: "POST", body: form });
            if (!uploaded.ok) throw new Error("Reference upload failed.");
            const file = await uploaded.json();
            if (file.name !== name || file.subfolder !== subfolder || file.type !== "input")
              throw new Error("Runtime changed the reference upload path.");
            existing = await fetchLocal(view);
          }
          if (
            !existing.ok ||
            createHash("sha256")
              .update(Buffer.from(await existing.arrayBuffer()))
              .digest("hex") !== sha
          )
            throw new Error("Runtime reference bytes do not match the approved recording/image.");
          workflow.joint.prompt[nodeId].inputs[kind] = `${subfolder}/${name}`;
        }
      return workflow;
    },
  });
  services.set(id, instance);
  return instance;
}
export async function reviewJoint(input: JointReviewInput) {
  if (JSON.stringify(input).length > 80 * 1024 * 1024)
    throw new Error("Reference review exceeds 80 MiB.");
  const mapped = validateCurrent(input);
  const workflow: Wrapped = {
    nodes: Object.keys(mapped.workflow).map((id) => ({ id })),
    joint: { prompt: mapped.workflow, input },
  };
  const p = picture(input.pictureId),
    draft = p.emotionPerformance!.drafts.find((d) => d.id === input.draftId)!;
  const result = await service(input.pictureId).review({
    pictureId: input.pictureId,
    sceneId: draft.sceneId,
    renderSlot: `cueboard:${input.draftId}`,
    workflowJson: JSON.stringify(workflow),
  });
  return result.ok
    ? {
        ...result,
        issues: [
          ...result.issues,
          ...mapped.unsupported_controls.map((f) => `${f.control} (${f.status}): ${f.reason}`),
        ],
      }
    : result;
}
export async function runJoint(input: { pictureId: string; reviewId: string }) {
  const result = await service(input.pictureId).run(input.reviewId);
  const promptId = result.ok ? result.promptId : result.promptId;
  if (promptId && !monitors.has(promptId)) {
    monitors.add(promptId);
    void (async () => {
      try {
        for (let attempt = 0; attempt < 720; attempt++) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 5000);
            timer.unref();
          });
          const status = await statusJoint({ pictureId: input.pictureId, promptId });
          if (status.ok && ["completed", "failed", "cancelled"].includes(status.status)) break;
        }
      } catch {
        /* Existing job journal remains recoverable through Check clip status. */
      } finally {
        monitors.delete(promptId);
      }
    })();
  }
  return result;
}
export async function statusJoint(input: { pictureId: string; promptId: string }) {
  const result = await service(input.pictureId).status(input.promptId);
  if (!result.ok || result.status !== "completed") return result;
  const outputs = [];
  for (const output of result.outputs) {
    const key = `${input.pictureId}:${input.promptId}:${output.url}`;
    let url = archived.get(key);
    if (!url) {
      const source = new URL(output.url);
      if (source.origin !== endpoint || source.pathname !== "/view")
        throw new Error("Unexpected generated media source.");
      const response = await fetch(source, {
        signal: AbortSignal.timeout(60000),
        redirect: "error",
      });
      if (!response.ok)
        throw new Error("Generated clip could not be copied to its project folder.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 512 * 1024 * 1024)
        throw new Error("Generated clip exceeds the 512 MiB archive limit.");
      url = projectLibraryService().saveGeneratedMedia(
        input.pictureId,
        `${input.promptId}-${output.filename}`,
        bytes,
      ).uri;
      archived.set(key, url);
    }
    outputs.push({ ...output, url });
  }
  return {
    ...result,
    outputs,
    message: `${outputs.length} generated clip(s) saved in the project folder, awaiting your review.`,
  };
}
