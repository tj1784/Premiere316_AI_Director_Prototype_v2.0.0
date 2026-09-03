import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HomeBay } from "@/components/studio/home";
import { StudioShell } from "@/components/studio/shell";
import { useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [ready, setReady] = useState(false);
  const activeId = useStudio((s) => s.activeId);
  const pictures = useStudio((s) => s.pictures);

  useEffect(() => {
    const persist = useStudio.persist as { hasHydrated?: () => boolean; rehydrate: () => void | Promise<void> };
    if (persist.hasHydrated?.()) {
      setReady(true);
      return;
    }
    void Promise.resolve(persist.rehydrate()).finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  const picture = pictures.find((p) => p.id === activeId) ?? null;
  return picture ? <StudioShell /> : <HomeBay />;
}
