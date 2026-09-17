import { Film } from "lucide-react";
import type { Picture } from "@/lib/studio/types";
import { useStudio } from "@/lib/studio/store";

export function VideoGenerationOptions({ picture }: { picture: Picture }) {
  const setEngines = useStudio((state) => state.setEngines);
  const options = [
    { id: "ltx-director", label: "LTX Director · Default" },
    { id: "ltx-2", label: "LTX-2 / LTX 2.5" },
    { id: "minimax-h3", label: "MiniMax H3" },
  ];
  const existing = options.some((item) => item.id === picture.selectedEngine.video);
  return <section className="mb-4 grid gap-3 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)] sm:grid-cols-2" aria-label="Video generation options">
    <div>
      <h3 className="flex items-center gap-2 font-display text-lg"><Film className="size-4 text-accent" aria-hidden="true" />Video generation</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">Create scenes, arrange segments and reuse asset images. Review your workflow, then generate video directly from Premiere.</p>
    </div>
    <label className="grid content-start gap-2 text-sm">Video generator
      <select aria-label="Video generator" className="h-11 min-w-0 w-full rounded-md bg-inset px-3 text-fg shadow-[var(--shadow-border)]" value={picture.selectedEngine.video} onChange={(event) => setEngines({ video: event.target.value })}>
        {!existing ? <option value={picture.selectedEngine.video}>{picture.selectedEngine.video}</option> : null}
        {options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <span className="text-xs text-muted">Saved for this picture.</span>
    </label>
  </section>;
}
