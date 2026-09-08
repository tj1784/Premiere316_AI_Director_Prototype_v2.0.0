import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { applyPreparedApproval, applyProductionAuthority, prepareAssetRecords, type ProductionBreakdown } from "@/lib/production";
import { desktopApprovePreparedImage, desktopProductionAuthorityStatus, desktopSealProductionAuthority, isDesktopApp } from "@/lib/desktop/client";
import { toast } from "sonner";

export function PreparedAssetsPanel({ record, visualApprovals, cinematographyApprovals, onChange }: { record: ProductionBreakdown; visualApprovals: string[]; cinematographyApprovals: string[]; onChange: (record: ProductionBreakdown) => void }) {
  const [approving, setApproving] = useState<string | null>(null);
  const [sealing, setSealing] = useState(false);
  const [backendStatus, setBackendStatus] = useState<Awaited<ReturnType<typeof desktopProductionAuthorityStatus>> | null>(null);
  const prepared = record.preparedAssets ?? [];
  const ready = prepared.filter((item) => item.status === "APPROVED_PREPARED").length;
  const refreshAuthorityStatus = async () => {
    if (!isDesktopApp()) return null;
    const status = await desktopProductionAuthorityStatus({ pictureId: record.pictureId });
    setBackendStatus(status);
    return status;
  };
  useEffect(() => { void refreshAuthorityStatus().catch(() => setBackendStatus({ ok: false, error: "Backend authority status unavailable." })); }, [record.pictureId, record.productionAuthority?.authorityId, record.productionAuthority?.digest]);
  const backendCurrent = backendStatus?.ok === true && backendStatus.status === "CURRENT" && backendStatus.authorityId === record.productionAuthority?.authorityId && backendStatus.digest === record.productionAuthority?.digest;
  const authorityMessage = backendStatus?.ok === true ? `Backend authority: ${backendStatus.status.replaceAll("_", " ").toLowerCase()}${backendCurrent ? " · exact current authority verified" : " · reseal/reconcile required"}` : backendStatus?.ok === false ? `Backend authority unavailable: ${backendStatus.error}` : "Backend authority status pending; privileged controls fail closed.";
  return (
    <section className="mt-6 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]" aria-label="Prepared assets gate">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-wide text-subtle uppercase">Prepared assets gate</p>
          <p className="mt-1 text-sm">{ready} / {prepared.length || record.assets.length} specs approved for Wave 4 preparation</p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">Evaluate creates engine-neutral READY/BLOCKED records only. Approve prepared is a separate native-confirmed root action.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={sealing || Boolean(approving)} onClick={() => onChange(prepareAssetRecords(record, visualApprovals, cinematographyApprovals))}>Evaluate prepared assets</Button>
          <Button disabled={sealing || Boolean(approving) || !prepared.length} onClick={async () => { setSealing(true); try { const result = await desktopSealProductionAuthority({ pictureId: record.pictureId, rawCanonical: record }); if (!result.ok) throw new Error(result.error); onChange(applyProductionAuthority(record, { authorityId: result.authorityId, digest: result.digest, createdAt: result.createdAt })); await refreshAuthorityStatus(); toast.success("Production authority sealed for prepared generation."); } catch (error) { toast.error(error instanceof Error ? error.message : "Production authority seal failed."); } finally { setSealing(false); } }}>{sealing ? "Sealing…" : "Seal production authority"}</Button>
        </div>
      </div>
      <div className="mt-3 rounded-md bg-inset p-3 text-xs text-muted shadow-[var(--shadow-border)]">{authorityMessage}</div>
      {record.productionAuthority?.status && record.productionAuthority.status !== "CURRENT" ? <div className="mt-3 rounded-md bg-inset p-3 text-xs text-muted shadow-[var(--shadow-border)]">Persisted authority hint is {record.productionAuthority.status.replaceAll("_", " ").toLowerCase()}; backend verification is required before approval or generation.</div> : null}
      {prepared.length ? <div className="mt-3 grid gap-2">{prepared.slice(0, 6).map((item) => <article key={item.id} className="rounded-md bg-inset p-3 shadow-[var(--shadow-border)]"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs" title={item.assetId}>{item.assetId}</p><Badge>{item.status.replaceAll("_", " ")}</Badge></div>{item.blockers.length ? <ul className="mt-2 list-disc pl-4 text-[11px] leading-relaxed text-muted">{item.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className="mt-2 text-[11px] text-muted">{item.status === "APPROVED_PREPARED" ? `Display-only local root ${item.preparedApprovalRootId?.slice(0, 28) ?? "missing"}…` : "Ready for native prepared approval. No generation has run."}</p>}<div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={sealing || Boolean(approving) || item.status !== "READY_TO_PREPARE" || !backendCurrent} onClick={async () => { setApproving(item.id); try { const latest = await refreshAuthorityStatus(); if (latest?.ok !== true || latest.status !== "CURRENT" || latest.authorityId !== record.productionAuthority?.authorityId || latest.digest !== record.productionAuthority?.digest) throw new Error("Backend authority is not current for this picture; reseal/reconcile before approval."); const authorityId = latest.authorityId ?? ""; const result = await desktopApprovePreparedImage({ authorityId, preparedAssetId: item.id }); if (!result.ok) throw new Error(result.error); onChange(applyPreparedApproval(record, { preparedAssetId: item.id, rootId: result.rootId, approvedAt: result.approvedAt, digest: result.digest, authorityId })); await refreshAuthorityStatus(); toast.success("Prepared asset approved with backend root."); } catch (error) { toast.error(error instanceof Error ? error.message : "Prepared approval failed."); } finally { setApproving(null); } }}>{approving === item.id ? "Approving…" : "Approve prepared"}</Button></div></article>)}</div> : null}
    </section>
  );
}
