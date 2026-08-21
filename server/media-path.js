import path from "node:path";

export const PROJECT_MEDIA_KINDS = new Set([
  "frames",
  "clips",
  "audio",
  "assets",
  "storyboard",
  "masters"
]);

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && !path.isAbsolute(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`);
}

export function resolveProjectMediaFile(projectsRoot, slug, kind, requestPath) {
  if (!PROJECT_MEDIA_KINDS.has(kind)) return null;
  if (typeof slug !== "string" || !slug || slug === "." || slug === "..") return null;
  if (path.basename(slug) !== slug) return null;
  if (typeof requestPath !== "string" || !requestPath || requestPath.includes("\0")) return null;

  // URL paths always use forward slashes. Reject Windows separators explicitly so
  // an encoded backslash cannot escape the selected project media directory.
  if (requestPath.includes("\\")) return null;
  const parts = requestPath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;

  const root = path.resolve(projectsRoot);
  const projectRoot = path.resolve(root, slug);
  if (!isInside(root, projectRoot)) return null;

  const kindRoot = path.resolve(projectRoot, "media", kind);
  const candidate = path.resolve(kindRoot, ...parts);
  return isInside(kindRoot, candidate) ? candidate : null;
}
