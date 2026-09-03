import { readFileSync, writeFileSync } from "node:fs";
import { deserializeWorkspace, serializeWorkspace } from "./domain.ts";
import type { PerformanceWorkspace } from "./types.ts";

export function persistWorkspaceToDisk(path: string, state: PerformanceWorkspace): void {
  writeFileSync(path, serializeWorkspace(state), "utf8");
}

export function loadWorkspaceFromDisk(path: string): PerformanceWorkspace {
  return deserializeWorkspace(readFileSync(path, "utf8"));
}
