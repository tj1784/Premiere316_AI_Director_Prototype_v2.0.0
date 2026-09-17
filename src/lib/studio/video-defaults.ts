import type { Picture } from "./types.ts";

/** Adopt the new default once; later explicit selections survive every reload. */
export function hydrateVideoDefaults(picture: Picture): Picture {
  if (picture.videoDefaultsVersion === 1) return picture;
  const video = picture.selectedEngine?.video;
  return {
    ...picture,
    videoDefaultsVersion: 1,
    selectedEngine: {
      ...picture.selectedEngine,
      video: !video || video === "ltx-2" ? "ltx-director" : video,
    },
  };
}
