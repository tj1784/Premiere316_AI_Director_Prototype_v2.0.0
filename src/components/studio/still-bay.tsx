import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";

/** Legacy shot bay retained as a disabled compatibility surface only. */
export function StillBay() {
  const closeStillBay = useStudio((s) => s.closeStillBay);
  return (
    <section aria-labelledby="still-bay-title" className="w-full max-w-xl rounded-xl border border-border bg-elevated p-5 shadow-[var(--shadow-border)]">
      <p className="text-[11px] tracking-wide text-subtle uppercase">Legacy shot stills disabled</p>
      <h2 id="still-bay-title" className="mt-1 font-display text-2xl tracking-tight">Prepared assets only</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">Wave 4 image generation is authorized from the Generate stage using approved prepared assets, immutable iterations, and Review-stage approval. This shot-level drawer cannot wake a model or write media.</p>
      <Button className="mt-4" type="button" variant="secondary" onClick={closeStillBay}>Dismiss notice</Button>
    </section>
  );
}
