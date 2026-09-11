import { Download, FileText } from "lucide-react";
import type { ImportedPicturePackage } from "@/lib/studio/imported-picture-package";

export function ImportedPackageResources({ importedPackage }: { importedPackage?: ImportedPicturePackage }) {
  if (!importedPackage) return null;
  const seconds = importedPackage.timingPlan.reduce((total, scene) => total + scene.duration_seconds, 0);
  return (
    <section aria-label="Imported screenplay package" className="rounded-lg bg-elevated p-4 text-fg">
      <div className="flex items-start gap-3">
        <FileText className="mt-1 size-4 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="font-medium">Complete screenplay package</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {seconds / 60} minute timing plan · {importedPackage.sourceAssets.length} asset records · {importedPackage.sceneAssetLinks.length} scene links · {importedPackage.continuity.length} continuity rules
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">Accepted screenplay and linked inventory imported. Asset and frame views show the current images and selections.</p>
        </div>
      </div>
      <details className="mt-2">
      <summary className="min-h-9 cursor-pointer content-center text-sm text-muted">Original files · {importedPackage.resources.length} downloads</summary>
      <div className="mt-1 flex flex-wrap gap-2">
        {importedPackage.resources.map((resource) => (
          <a key={resource.fileName} href={resource.href} download={resource.fileName} className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted transition-colors hover:bg-inset hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none">
            <Download className="size-3 shrink-0" aria-hidden="true" />{resource.label}
          </a>
        ))}
      </div>
      </details>
    </section>
  );
}
