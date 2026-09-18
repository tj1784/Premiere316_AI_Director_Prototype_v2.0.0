import type {
  DirectorReviewInput,
  DirectorReviewResult,
  DirectorRunResult,
  DirectorJobStatusResult,
  DirectorOpenResult,
} from "../src/lib/studio/director-execution.ts";
export const DIRECTOR_ENDPOINT: string;
export type DirectorExecutionService = {
  review(input: DirectorReviewInput): Promise<DirectorReviewResult>;
  run(id: string): Promise<DirectorRunResult>;
  status(id: string): Promise<DirectorJobStatusResult>;
  open(input: DirectorReviewInput): Promise<DirectorOpenResult>;
};
export function createDirectorExecutionService(options: {
  directory: string;
  endpoint?: string;
  ensureHost: () => Promise<unknown>;
  openWorkflow: (...args: unknown[]) => Promise<boolean>;
  getProgress?: (id: string) => unknown;
  fetchImpl?: typeof fetch;
  compile?: Function;
  prepareWorkflow?: Function;
  now?: () => number;
  uuid?: () => string;
  journalImpl?: Function;
}): DirectorExecutionService;
