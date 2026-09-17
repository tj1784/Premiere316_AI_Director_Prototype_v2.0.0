export type DirectorSceneSelection = { pictureId: string; sceneId: string; focusId: string | null };

type Scene = { sceneId: string };
type Shot = { id: string; sceneId: string };

/** Follow a newly focused shot, while keeping an explicit scene choice until focus changes. */
export function resolveDirectorSceneSelection(
  pictureId: string,
  scenes: readonly Scene[],
  shots: readonly Shot[],
  focusIds: readonly (string | null)[],
  previous: DirectorSceneSelection | null,
): DirectorSceneSelection {
  const available = (sceneId: string) => scenes.some((scene) => scene.sceneId === sceneId);
  const focusedShot = focusIds.flatMap((id) => shots.filter((shot) => shot.id === id && available(shot.sceneId)))[0];
  const focusId = focusedShot?.id ?? null;
  const remembered = previous?.pictureId === pictureId && available(previous.sceneId) ? previous : null;
  const sceneId = remembered && remembered.focusId === focusId ? remembered.sceneId
    : focusedShot?.sceneId ?? remembered?.sceneId ?? scenes[0]?.sceneId ?? "";
  return { pictureId, sceneId, focusId };
}

export function readDirectorSceneSelection(pictureId: string): DirectorSceneSelection | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`premiere316:director-scene:${pictureId}`) ?? "null");
    return value?.pictureId === pictureId && typeof value.sceneId === "string" && (value.focusId === null || typeof value.focusId === "string") ? value : null;
  } catch { return null; }
}

export function rememberDirectorSceneSelection(selection: DirectorSceneSelection): void {
  try { sessionStorage.setItem(`premiere316:director-scene:${selection.pictureId}`, JSON.stringify(selection)); }
  catch { /* Scene switching still works when browser session storage is unavailable. */ }
}
