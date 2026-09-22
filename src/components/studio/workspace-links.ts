import { useStudio } from "@/lib/studio/store";
import type { Picture, StageId } from "@/lib/studio/types";
import { parseScreenplayHierarchy } from "@/lib/studio/screenplay-hierarchy";
import { toast } from "sonner";

/** Navigation changes only persistent editor preferences, never canonical source records. */
function navigate(pictureId: string, stage: StageId, preferences: Record<string, unknown>) {
  const state = useStudio.getState();
  const picture = state.pictures.find((p) => p.id === pictureId);
  if (!picture) return;
  state.replaceActive({
    ...picture,
    workspacePanel: null,
    editorDrafts: { ...picture.editorDrafts, ...preferences },
  });
  state.openAdvancedDepartment(stage);
}
export function openCharacterSheet(pictureId: string, recordId: string) {
  navigate(pictureId, "visual-development", {
    "characters-workspace-view": "sheets",
    "character-dossier-world": "character",
    "bible-record:Characters & world": recordId,
    "bible-category:Characters & world": "all",
    "bible-field-group:Characters & world": "all",
  });
}
export function openAssetIterations(pictureId: string, assetId: string) {
  navigate(pictureId, "inventory", {
    "asset-workspace-view": "library",
    "asset-library-category": "all",
    "asset-library-selection": assetId,
    "asset-library-inspector": "preview",
    "asset-library-iteration": "",
  });
}
export function openScreenplayScene(picture: Picture, sceneId: string) {
  const scenes = parseScreenplayHierarchy(
    picture.screenplay.workingFountain,
    picture.screenplay.hierarchy,
  ).nodes.filter((n) => n.kind === "scene" && !n.tombstoned);
  const canonical =
    picture.production?.scenes.find((s) => s.id === sceneId) ??
    picture.scenes.find((s) => s.id === sceneId);
  const byHeading = canonical
    ? scenes.filter((s) => s.slugline === canonical.slugline || s.title === canonical.slugline)
    : [];
  const scene =
    scenes.find((s) => s.id === sceneId) ?? (byHeading.length === 1 ? byHeading[0] : undefined);
  if (!scene) {
    toast.message(
      "This scene has no unambiguous match in the current draft. Open the full screenplay to locate it.",
    );
    return;
  }
  navigate(picture.id, "screenplay", {
    "screenplay-selected-scene": scene.id,
    "screenplay-scene-view": true,
    "screenplay-inspector-tab": "context",
  });
}
