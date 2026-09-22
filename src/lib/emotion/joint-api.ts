import { createServerFn } from "@tanstack/react-start";
import type { ApiWorkflow, SpeakerReference } from "./joint-generation.ts";
export type JointReviewInput = {
  shotId?: string;
  pictureId: string;
  draftId: string;
  lineIds: string[];
  workflow: ApiWorkflow;
  conditioningNodeId: string;
  basePrompt: string;
  references: Array<
    SpeakerReference & { imageIterationId: string; imageData: string; audioData: string }
  >;
};
export const reviewJointWorkflow = createServerFn({ method: "POST" })
  .validator((input: JointReviewInput) => input)
  .handler(async ({ data }) => (await import("./joint-api.server")).reviewJoint(data));
export const runJointWorkflow = createServerFn({ method: "POST" })
  .validator((input: { pictureId: string; reviewId: string }) => input)
  .handler(async ({ data }) => (await import("./joint-api.server")).runJoint(data));
export const jointJobStatus = createServerFn({ method: "POST" })
  .validator((input: { pictureId: string; promptId: string }) => input)
  .handler(async ({ data }) => (await import("./joint-api.server")).statusJoint(data));
