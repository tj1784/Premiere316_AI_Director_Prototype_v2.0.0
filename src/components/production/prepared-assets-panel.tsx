import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prepareAssetRecords, type ProductionBreakdown } from "@/lib/production";

export function PreparedAssetsPanel({ record, visualApprovals, cinematographyApprovals, onChange }: { record: ProductionBreakdown; visualApprovals: string[]; cinematographyApprovals: string[]; onChange: (record: ProductionBreakdown) => void }) {
  const prepared = record.preparedAssets ?? [];
  const ready = prepared.filter((item) => item.status === "APPROVED_PREPARED").length;
  return (
    <section className="mt-6 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]" aria-label="Prepared assets gate">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-wide text-subtle uppercase">Prepared assets gate</p>
          <p className="mt-1 text-sm">{ready} / {prepared.length || record.assets.length} specs approved for Wave 4 preparation</p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">This creates engine-neutral prompt ingredients and blockers only. It never generates media.</p>
        </div>
        <Button variant="secondary" onClick={() => onChange(prepareAssetRecords(record, visualApprovals, cinematographyApprovals))}>Evaluate prepared assets</Button>
      </div>
      {prepared.length ? <div className="mt-3 grid gap-2">{prepared.slice(0, 6).map((item) => <article key={item.id} className="rounded-md bg-inset p-3 shadow-[var(--shadow-border)]"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs" title={item.assetId}>{item.assetId}</p><Badge>{item.status.replaceAll("_", " ")}</Badge></div>{item.blockers.length ? <ul className="mt-2 list-disc pl-4 text-[11px] leading-relaxed text-muted">{item.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className="mt-2 text-[11px] text-muted">Ready for Wave 4 native image path. No generation has run.</p>}</article>)}</div> : null}
    </section>
  );
}
