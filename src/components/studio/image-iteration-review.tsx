import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label, Textarea } from "@/components/ui/field";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";
import {
  desktopProductionAuthorityStatus,
  desktopApproveCanonicalImage,
  desktopRejectCanonicalImage,
  isDesktopApp,
} from "@/lib/desktop/client";
import {
  approveCanonicalIteration,
  deterministicContinuityFindings,
  reviewGeneratedIteration,
} from "@/lib/production";
import "./image-review-cinema.css";
function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted">{k}</dt>
      <dd className="mt-1 break-all">{v}</dd>
    </div>
  );
}
export function ImageIterationReview({
  picture,
  iterationId,
  onIterationSelect,
}: {
  picture: Picture;
  iterationId?: string;
  onIterationSelect?: (id: string) => void;
}) {
  const production = picture.production;
  const replaceActive = useStudio((state) => state.replaceActive);
  const iterations =
    production?.assets.flatMap((asset) =>
      asset.iterations
        .filter((iteration) => !iterationId || iteration.id === iterationId)
        .map((iteration) => ({ asset, iteration })),
    ) ?? [];
  const allIterations = production?.assets.flatMap((asset) => asset.iterations.map((iteration) => ({ asset, iteration }))) ?? [];
  const selectedIteration = allIterations.find(({ iteration }) => iteration.id === iterationId) ?? allIterations[0];
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [backendStatus, setBackendStatus] = useState<Awaited<
    ReturnType<typeof desktopProductionAuthorityStatus>
  > | null>(null);
  const refreshAuthorityStatus = useCallback(async () => {
    if (!isDesktopApp()) return null;
    const status = await desktopProductionAuthorityStatus({ pictureId: picture.id });
    setBackendStatus(status);
    return status;
  }, [picture.id]);
  useEffect(() => {
    void refreshAuthorityStatus().catch(() =>
      setBackendStatus({ ok: false, error: "Backend authority status unavailable." }),
    );
  }, [refreshAuthorityStatus]);
  const authorityCurrent =
    backendStatus?.ok === true &&
    backendStatus.status === "CURRENT" &&
    backendStatus.authorityId === production?.productionAuthority?.authorityId &&
    backendStatus.digest === production?.productionAuthority?.digest;
  const verifiedRoots = new Map(
    (backendStatus?.ok === true ? (backendStatus.preparedApprovals ?? []) : []).map((root) => [
      root.preparedAssetId,
      root,
    ]),
  );
  const backendCanonicalHistory =
    backendStatus?.ok === true ? (backendStatus.canonicalHistory ?? []) : [];
  function applyReview(nextProduction: NonNullable<Picture["production"]>) {
    const latest = useStudio.getState().pictures.find((p) => p.id === picture.id);
    if (latest) replaceActive({ ...latest, production: nextProduction, updatedAt: Date.now() });
  }
  return (
    <section aria-label="Image review decisions" className="image-review-decision">
      {allIterations.length > 1 && onIterationSelect && <details className="image-review-picker"><summary>Image iteration · {selectedIteration?.asset.name} · {selectedIteration?.iteration.status.replaceAll("_", " ")}</summary><div className="image-review-options">{allIterations.map(({ asset, iteration }) => <button type="button" key={iteration.id} aria-current={iteration.id === selectedIteration?.iteration.id ? "true" : undefined} onClick={(event) => { onIterationSelect(iteration.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{asset.name} · {iteration.status.replaceAll("_", " ")}</button>)}</div></details>}
      <details className="image-review-authority">
        <summary>{backendStatus?.ok === true ? `Approval record · ${backendStatus.status.replaceAll("_", " ").toLowerCase()}` : "Approval record · unavailable"}</summary>
        <p>{backendStatus?.ok === true
          ? `Backend authority: ${backendStatus.status.replaceAll("_", " ").toLowerCase()}${authorityCurrent ? " · exact current authority verified" : " · reseal/reconcile required"} · scoped decisions ${backendCanonicalHistory.length}`
          : backendStatus?.ok === false
            ? `Backend authority unavailable: ${backendStatus.error}`
            : isDesktopApp()
              ? "Verifying current approval authority…"
              : "Image approval requires the desktop app’s verified media records."}</p>
      </details>
      <div className="image-review-items">
        {iterations.length ? (
          iterations.map(({ asset, iteration }) => {
            const findings = iteration.receiptContinuityFindings?.length
              ? iteration.receiptContinuityFindings
              : deterministicContinuityFindings(asset, iteration);
            const reason = reasons[iteration.id] ?? "";
            const allRequiredConfirmed = findings.every(
              (finding) => finding.severity !== "blocker" || confirmed[finding.id],
            );
            const verifiedRoot = verifiedRoots.get(iteration.preparedAssetId ?? "");
            const rootCurrent = Boolean(
              verifiedRoot &&
              verifiedRoot.rootId ===
                (production?.preparedAssets ?? []).find(
                  (item) => item.id === iteration.preparedAssetId,
                )?.preparedApprovalRootId &&
              verifiedRoot.authorityId === production?.productionAuthority?.authorityId &&
              verifiedRoot.authorityDigest === production?.productionAuthority?.digest,
            );
            const backendDecision = backendCanonicalHistory.find(
              (entry) =>
                typeof entry === "object" &&
                entry &&
                "iterationId" in entry &&
                entry.iterationId === iteration.id,
            ) as { kind?: string } | undefined;
            const backendCanonical = backendDecision?.kind === "canonicalDecision";
            const backendRejected = backendDecision?.kind === "rejectionDecision";
            return (
              <article
                key={iteration.id}
                className="image-review-item"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] tracking-wide text-subtle uppercase">
                      {backendCanonical
                        ? "APPROVED"
                        : backendRejected
                          ? "REJECTED"
                          : iteration.status}
                    </p>
                    <h3 className="font-display text-xl">{asset.name}</h3>
                  </div>
                  <Badge>
                    {backendCanonical ? "canonical" : backendRejected ? "rejected" : "iteration"}
                  </Badge>
                </div>
                <div className="image-review-compare">
                  <div>
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Approved reference/spec</span>
                      <span>A</span>
                    </div>
                    <div className="image-review-spec text-xs leading-relaxed">
                      {asset.canonicalSpec.visualDescription ||
                        asset.canonicalSpec.distinguishingFeatures.join(" · ") ||
                        "No approved visual description recorded."}
                    </div>
                  </div>
                  <div><div className="flex items-center justify-between text-xs text-muted"><span>Candidate on canvas</span><span>B</span></div><p className="image-review-spec text-xs">{iteration.mediaUri ? `Actual iteration · ${iteration.status.replaceAll("_", " ").toLowerCase()}` : "Media is unavailable; approval remains blocked."}</p></div>
                </div>
                <details className="image-review-evidence"><summary>Image provenance & exact file</summary><p className="break-all text-xs">{iteration.mediaUri || "No durable media URI"}</p><dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <Stat
                    k="Media hash"
                    v={
                      iteration.mediaSha256
                        ? `${iteration.mediaSha256.slice(0, 10)}…`
                        : "not recorded"
                    }
                  />
                  <Stat
                    k="Sidecar"
                    v={
                      iteration.sidecarSha256
                        ? `${iteration.sidecarSha256.slice(0, 10)}…`
                        : "not recorded"
                    }
                  />
                  <Stat
                    k="Size"
                    v={
                      iteration.width && iteration.height
                        ? `${iteration.width} × ${iteration.height}`
                        : "unknown"
                    }
                  />
                  <Stat
                    k="Decisions"
                    v={String(
                      iteration.reviewDecisionIds?.length ?? iteration.reviewDecisions?.length ?? 0,
                    )}
                  />
                </dl></details>
                <fieldset className="image-review-checklist">
                  <legend className="text-[11px] tracking-wide text-subtle uppercase">
                    Continuity checklist
                  </legend>
                  {findings.length ? (
                    findings.map((finding) => (
                      <label
                        key={finding.id}
                        className="mt-2 flex min-h-11 items-start gap-2 text-xs text-muted"
                      >
                        <input
                          className="mt-1"
                          type="checkbox"
                          checked={Boolean(confirmed[finding.id])}
                          onChange={(event) =>
                            setConfirmed((current) => ({
                              ...current,
                              [finding.id]: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          <span className={finding.severity === "blocker" ? "text-rec" : "text-fg"}>
                            {finding.severity}
                          </span>{" "}
                          · {finding.message}
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="mt-2 text-xs text-muted">
                      No automated vision claim is made. Enter a visible review reason before
                      approval.
                    </p>
                  )}
                </fieldset>
                <div className="mt-3">
                  <Label htmlFor={`reason-${iteration.id}`}>Reviewer reason</Label>
                  <Textarea
                    id={`reason-${iteration.id}`}
                    className="mt-1.5 min-h-20"
                    value={reason}
                    onChange={(event) =>
                      setReasons((current) => ({ ...current, [iteration.id]: event.target.value }))
                    }
                    placeholder="Describe the visible identity/continuity evidence for this decision."
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={
                      !production ||
                      !authorityCurrent ||
                      !rootCurrent ||
                      !iteration.generationReceiptId ||
                      !iteration.generationReceiptDigest ||
                      backendRejected ||
                      backendCanonical ||
                      !reason.trim() ||
                      !allRequiredConfirmed
                    }
                    title="Verify durable media, then approve this reviewed iteration as canonical"
                    onClick={async () => {
                      if (!production) return;
                      try {
                        const latest = await refreshAuthorityStatus();
                        const latestRoot =
                          latest?.ok === true
                            ? (latest.preparedApprovals ?? []).find(
                                (root) => root.preparedAssetId === iteration.preparedAssetId,
                              )
                            : null;
                        const preparedApprovalRootId =
                          (production.preparedAssets ?? []).find(
                            (item) => item.id === iteration.preparedAssetId,
                          )?.preparedApprovalRootId ?? "";
                        if (
                          latest?.ok !== true ||
                          latest.status !== "CURRENT" ||
                          latest.authorityId !== production.productionAuthority?.authorityId ||
                          latest.digest !== production.productionAuthority?.digest ||
                          latestRoot?.rootId !== preparedApprovalRootId
                        )
                          throw new Error(
                            "Backend authority/prepared root mismatch; reseal or re-approve before canonical approval.",
                          );
                        const confirmedContinuityFindings = findings.map((finding) => ({
                          ...finding,
                          confirmed: finding.confirmed || Boolean(confirmed[finding.id]),
                        }));
                        const approved = await desktopApproveCanonicalImage({
                          authorityId: latest.authorityId ?? "",
                          preparedApprovalRootId,
                          receiptId: iteration.generationReceiptId ?? "",
                          iterationId: iteration.id,
                          reason,
                          findings: confirmedContinuityFindings.map(({ id, confirmed }) => ({
                            id,
                            confirmed,
                          })),
                        });
                        if (!approved.ok) throw new Error(approved.error);
                        applyReview(
                          approveCanonicalIteration(production, {
                            iterationId: iteration.id,
                            reviewer: "user",
                            reason,
                            canonicalProof: approved.proof,
                            continuityFindings: confirmedContinuityFindings,
                          }),
                        );
                        await refreshAuthorityStatus();
                        toast.success("Canonical image iteration approved.");
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Canonical approval failed.",
                        );
                      }
                    }}
                  >
                    Approve canonical
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !production ||
                      !authorityCurrent ||
                      !rootCurrent ||
                      backendRejected ||
                      backendCanonical ||
                      !iteration.generationReceiptId ||
                      !reason.trim()
                    }
                    title="Reject this iteration append-only"
                    onClick={async () => {
                      if (!production) return;
                      try {
                        const latest = await refreshAuthorityStatus();
                        const latestRoot =
                          latest?.ok === true
                            ? (latest.preparedApprovals ?? []).find(
                                (root) => root.preparedAssetId === iteration.preparedAssetId,
                              )
                            : null;
                        const preparedApprovalRootId =
                          (production.preparedAssets ?? []).find(
                            (item) => item.id === iteration.preparedAssetId,
                          )?.preparedApprovalRootId ?? "";
                        if (
                          latest?.ok !== true ||
                          latest.status !== "CURRENT" ||
                          latest.authorityId !== production.productionAuthority?.authorityId ||
                          latest.digest !== production.productionAuthority?.digest ||
                          latestRoot?.rootId !== preparedApprovalRootId
                        )
                          throw new Error(
                            "Backend authority/prepared root mismatch; reseal or re-approve before rejection.",
                          );
                        const rejected = await desktopRejectCanonicalImage({
                          authorityId: latest.authorityId ?? "",
                          preparedApprovalRootId,
                          receiptId: iteration.generationReceiptId ?? "",
                          iterationId: iteration.id,
                          reason,
                        });
                        if (!rejected.ok) throw new Error(rejected.error);
                        applyReview(
                          reviewGeneratedIteration(production, {
                            iterationId: iteration.id,
                            decision: "reject",
                            reviewer: "user",
                            reason,
                          }),
                        );
                        await refreshAuthorityStatus();
                        toast.success("Image iteration rejected.");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Reject failed.");
                      }
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </article>
            );
          })
        ) : (
          <p className="p-4 text-sm text-muted">No generated iterations to review yet.</p>
        )}
      </div>
    </section>
  );
}
