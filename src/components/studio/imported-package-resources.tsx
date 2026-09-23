import { ChevronDown, Download, FileText } from "lucide-react";
import { formatRuntimeMinutes } from "@/lib/utils";
import type { ImportedPicturePackage } from "@/lib/studio/imported-picture-package";

export function ImportedPackageResources({
  importedPackage,
}: {
  importedPackage?: ImportedPicturePackage;
}) {
  if (!importedPackage) return null;
  const seconds = importedPackage.timingPlan.reduce(
    (total, scene) => total + scene.duration_seconds,
    0,
  );

  return (
    <section aria-label="Imported screenplay package" className="screenplay-package">
      <details>
        <summary className="screenplay-package-trigger">
          <FileText size={15} aria-hidden="true" />
          <span>Complete screenplay package</span>
          <span className="screenplay-package-count">
            {importedPackage.resources.length} original files
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="screenplay-package-content">
          <p>
            {formatRuntimeMinutes(seconds / 60)} timing plan · {importedPackage.sourceAssets.length}{" "}
            asset records · {importedPackage.sceneAssetLinks.length} scene links ·{" "}
            {importedPackage.continuity.length} continuity rules
          </p>
          <p>
            Accepted screenplay and linked inventory imported. Asset and frame views show the
            current images and selections.
          </p>
          <div className="screenplay-package-downloads" aria-label="Original package files">
            {importedPackage.resources.map((resource) => (
              <a key={resource.fileName} href={resource.href} download={resource.fileName}>
                <Download size={14} aria-hidden="true" />
                {resource.label}
              </a>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}
