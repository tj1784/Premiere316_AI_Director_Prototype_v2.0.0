import { Clapperboard } from "lucide-react";
import { makePictureIntake } from "@/lib/studio/picture-intake";
import { MODEL_ROOT } from "@/lib/studio/types";
import { useStudio } from "@/lib/studio/store";
import { InterfaceScale } from "./interface-scale";
import { PicturesLibrary } from "./pictures-library";

export function HomeBay() {
  const pictures = useStudio((state) => state.pictures);
  const openPicture = useStudio((state) => state.openPicture);
  const newPicture = useStudio((state) => state.newPicture);

  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="relative grid size-10 place-items-center rounded-md bg-elevated shadow-[var(--shadow-border)]">
            <Clapperboard className="size-4 text-accent" aria-hidden="true" />
          </span>
          <div>
            <p className="font-display text-lg leading-tight tracking-tight">Premiere316</p>
            <p className="text-[11px] tracking-[0.18em] text-muted uppercase">V3.02 · Standalone · No ComfyUI</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <p className="hidden max-w-64 truncate text-[11px] text-subtle sm:block" title={MODEL_ROOT}>{MODEL_ROOT}</p>
          <InterfaceScale />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
        <PicturesLibrary pictures={pictures} onNew={() => newPicture(makePictureIntake())} onOpen={openPicture} />
      </main>
    </div>
  );
}
