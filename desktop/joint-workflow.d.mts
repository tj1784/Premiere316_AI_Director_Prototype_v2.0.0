import type { ApiWorkflow } from "../src/lib/emotion/joint-generation.ts";
export function compileJointWorkflow(
  workflow: { joint: { prompt: ApiWorkflow } },
  info: Record<string, unknown>,
): { prompt: ApiWorkflow; issues: string[]; nodeCount: number };
