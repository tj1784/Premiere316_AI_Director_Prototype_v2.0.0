import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";

/** Legacy shot bay retained as a disabled compatibility surface only. */
export function StillBay() {
  const closeStillBay = useStudio((s) => s.closeStillBay);
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-bg/70 p-3 sm:place-items-center" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Dismiss disabled still bay" onClick={closeStillBay} />
      <section role="dialog" aria-labelledby="still-bay-title" className="relative z-10 w-full max-w-md rounded-lg bg-elevated p-5 shadow-[var(--shadow-border)]">
        <p className="text-[11px] tracking-wide text-subtle uppercase">Legacy shot stills disabled</p>
        <h2 id="still-bay-title" className="mt-1 font-display text-2xl tracking-tight">Prepared assets only</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">Wave 4 image generation is authorized from the Generate stage using approved prepared assets, immutable iterations, and Review-stage approval. This shot-level drawer cannot wake a model or write media.</p>
        <Button className="mt-4" type="button" variant="secondary" onClick={closeStillBay}>Close</Button>
      </section>
    </div>
  );
}
