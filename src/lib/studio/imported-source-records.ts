import type { Picture } from "./types.ts";
import type { ImportedPicturePackage } from "./imported-picture-package.ts";

/** Discovery pointers into the original package manifest, not copies of its files. */
export function packageSourceRecords(imported: ImportedPicturePackage) {
  const linked = new Map(imported.resources.map((resource) => [resource.fileName, resource]));
  return Object.entries(imported.sourceSha256).map(([fileName, sha256]) => {
    const resource = linked.get(fileName);
    return {
      id: `package-source:${encodeURIComponent(imported.packageId)}:${encodeURIComponent(fileName)}`,
      fileName,
      label: resource?.label ?? fileName,
      href: resource?.href ?? null,
      sha256,
      importedAt: imported.importedAt,
      packageId: imported.packageId,
      // Research notes are stored losslessly in the package owner. Other files
      // are opened from their original bytes, never reconstructed from a draft.
      text: fileName === "Research_and_Adaptation_Notes.md" ? imported.researchNotes : null,
    };
  });
}

export function importedSourceRecords(picture: Picture) {
  return picture.importedPackage ? packageSourceRecords(picture.importedPackage) : [];
}
