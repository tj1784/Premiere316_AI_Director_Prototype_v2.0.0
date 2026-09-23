import { PRODIGAL_SON_PICTURE_ID } from "./prodigal-son.ts";

export type BundledScenePreview = {
  preview: string;
  source: string;
  scene: string;
  shot: string;
  endpoint: "first" | "last";
  description: string;
};

export type ResolvedStillPreview = {
  uri: string;
  kind: "starting image" | "first frame" | "last frame" | "shot still";
};

export type BundledMediaMap = Record<string, string>;
let sceneRequest: Promise<BundledScenePreview[]> | null = null;
let mediaRequest: Promise<BundledMediaMap> | null = null;

export function loadBundledScenePreviews(): Promise<BundledScenePreview[]> {
  if (!sceneRequest) sceneRequest = fetch("/pictures/prodigal-son/previews/scene-frame-previews.json")
    .then((response) => response.ok ? response.json() : null)
    .then((manifest: { frames?: BundledScenePreview[] } | null) => Array.isArray(manifest?.frames)
      ? manifest.frames.filter((frame) => frame.preview.startsWith("/pictures/prodigal-son/previews/") && frame.source.startsWith("public/pictures/prodigal-son/frames/") && (frame.endpoint === "first" || frame.endpoint === "last"))
      : [])
    .catch(() => []);
  return sceneRequest;
}

/** The exported map ties exact original PNG URIs to their recovered WebP bytes. */
export function loadBundledMediaMap(): Promise<BundledMediaMap> {
  if (!mediaRequest) mediaRequest = fetch("/pictures/prodigal-son/previews/bundled-media-map.json")
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("Bundled image map unavailable")))
    .then((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(Object.entries(value).filter(([source, preview]) =>
        source.startsWith("/pictures/prodigal-son/")
        && typeof preview === "string"
        && preview.startsWith("/pictures/prodigal-son/previews/bundled/")
        && preview.endsWith(".webp"),
      ));
    })
    .catch(() => { mediaRequest = null; return {}; });
  return mediaRequest;
}

export function resolveSiteImageUri(pictureId: string, uri: string | undefined, mediaMap: BundledMediaMap): string | null {
  if (!uri) return null;
  if (pictureId !== PRODIGAL_SON_PICTURE_ID || !uri.startsWith("/pictures/prodigal-son/")) return uri;
  if (uri.startsWith("/pictures/prodigal-son/previews/")) return uri;
  return mediaMap[uri] ?? null;
}

/** Resolve only the exact frame/starter path, never an adjacent shot or a draft. */
export function resolveSiteStillPreview(
  pictureId: string,
  stillUrl: string | undefined,
  scenePreviews: BundledScenePreview[],
  mediaMap: BundledMediaMap,
): ResolvedStillPreview | null {
  if (!stillUrl) return null;
  const uri = resolveSiteImageUri(pictureId, stillUrl, mediaMap);
  if (uri) {
    const frame = scenePreviews.find((item) => item.preview === uri);
    const kind = stillUrl.includes("/director/starting-images/") ? "starting image" : frame ? `${frame.endpoint} frame` as const : "shot still";
    return { uri, kind };
  }
  const exact = scenePreviews.find((frame) => `/${frame.source.replace(/^public\//, "")}` === stillUrl);
  return exact ? { uri: exact.preview, kind: `${exact.endpoint} frame` } : null;
}
