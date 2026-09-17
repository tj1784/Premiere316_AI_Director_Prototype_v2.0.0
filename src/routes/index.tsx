import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HomeBay } from "@/components/studio/home";
import { StudioShell } from "@/components/studio/shell";
import { useStudio } from "@/lib/studio/store";
import { PROJECT_STORAGE_ERROR_EVENT } from "@/lib/studio/project-storage";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const activeId = useStudio((s) => s.activeId);
  const pictures = useStudio((s) => s.pictures);

  useEffect(() => {
    let disposed = false;
    const report = (event: Event) => {
      const detail = (event as CustomEvent<{ operation: string; message: string }>).detail;
      if (detail.operation === "read") setLoadError(detail.message);
      else toast.error(detail.message, { duration: 10000 });
    };
    window.addEventListener(PROJECT_STORAGE_ERROR_EVENT, report);
    const persist = useStudio.persist as { hasHydrated?: () => boolean; rehydrate: () => void | Promise<void> };
    if (persist.hasHydrated?.()) {
      setReady(true);
    } else {
      void Promise.resolve(persist.rehydrate()).then(() => {
        if (disposed) return;
        if (persist.hasHydrated?.()) setReady(true);
        else setLoadError((current) => current ?? "Your saved pictures could not be opened. They have not been replaced.");
      }).catch(() => {
        if (!disposed) setLoadError("Your saved pictures could not be opened. They have not been replaced.");
      });
    }
    return () => { disposed = true; window.removeEventListener(PROJECT_STORAGE_ERROR_EVENT, report); };
  }, []);

  if (!ready) return <main className="grid min-h-dvh place-content-center gap-4 bg-bg p-6 text-fg" aria-live="polite">
    <h1 className="font-display text-xl">{loadError ? "Could not open saved pictures" : "Opening your pictures…"}</h1>
    {loadError ? <><p className="max-w-lg text-sm text-muted">{loadError}</p><Button onClick={() => window.location.reload()}>Retry</Button></> : null}
  </main>;
  const picture = pictures.find((p) => p.id === activeId) ?? null;
  return picture ? <StudioShell /> : <HomeBay />;
}
