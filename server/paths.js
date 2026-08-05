// Absolute roots for premiere316 — never depend on process.cwd().
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.join(__dirname, "..");
export const PROJECTS_DIR = path.join(PACKAGE_ROOT, "projects");
export const WORKFLOWS_DIR = path.join(PACKAGE_ROOT, "workflows");
export const CLIENT_DIST = path.join(PACKAGE_ROOT, "client", "dist");

export function projectDir(slug) {
  return path.join(PROJECTS_DIR, slug);
}

export function workflowPath(name) {
  return path.join(WORKFLOWS_DIR, name);
}

export function mediaDir(project, kind) {
  return path.join(projectDir(project.slug || project), "media", kind);
}
