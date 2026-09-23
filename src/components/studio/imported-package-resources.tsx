import { ChevronDown, Download, FileText } from "lucide-react";
import { formatRuntimeMinutes } from "@/lib/utils";
import type { ImportedPicturePackage } from "@/lib/studio/imported-picture-package";
import { packageSourceRecords } from "@/lib/studio/imported-source-records";

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
  const sourceManifest = packageSourceRecords(importedPackage);

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
          <details className="mt-4 rounded border border-border p-3">
            <summary className="cursor-pointer text-sm">
              Source manifest · {sourceManifest.length} recorded files
            </summary>
            <ul className="mt-3 grid gap-3 text-xs">
              {sourceManifest.map((source) => (
                <li key={source.id} className="min-w-0 break-words border-t border-border pt-2">
                  {source.href ? (
                    <a href={source.href} download={source.fileName} className="underline underline-offset-2">
                      {source.fileName}
                    </a>
                  ) : (
                    <span>{source.fileName} · no direct file link</span>
                  )}
                  <p className="mt-1 break-all text-muted">SHA-256 {source.sha256}</p>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </details>
    </section>
  );
}
