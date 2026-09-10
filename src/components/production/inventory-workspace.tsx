import { useState, type ReactNode } from "react";
import { AlertTriangle, Boxes, ImageOff, ListFilter, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  PRODUCTION_CATEGORIES,
  breakdownPreflight,
  filterInventoryAssets,
  inventoryCards,
  prepareAssetQueue,
  type AssetReadiness,
  type ProductionAsset,
  type ProductionBreakdown,
  type ProductionCategory,
} from "@/lib/production";
import type { ApprovedScreenplayBoundary } from "@/lib/studio/screenplay";
import { cn } from "@/lib/utils";
import { AssetInspector } from "./asset-inspector";
import { AddAssetDialog } from "./inventory-dialogs";
import { PRODUCTION_CATEGORY_LABELS } from "./inventory-constants";
import { ReadinessBadge } from "./inventory-primitives";
import { PreparedAssetsPanel } from "./prepared-assets-panel";
import { AssetReferenceUpload } from "./asset-reference-upload";

type PreflightFilter = "all" | "ready" | "review" | "blocked";

const PREFLIGHT_STATES: Record<Exclude<PreflightFilter, "all">, AssetReadiness[]> = {
  ready: ["READY_TO_GENERATE", "READY_TO_PREPARE", "READY_FOR_REVIEW", "APPROVED_SPEC", "APPROVED_PREPARED", "GENERATED", "APPROVED"],
  review: ["PREPARING", "NEEDS_REVIEW", "STALE"],
  blocked: ["BLOCKED"],
};

export type InventoryWorkspaceProps = {
  boundary: ApprovedScreenplayBoundary | null;
  record: ProductionBreakdown | null;
  busy?: boolean;
  onRunBreakdown: (boundary: ApprovedScreenplayBoundary) => void | Promise<void>;
  onChange: (record: ProductionBreakdown) => void;
  visualApprovals?: string[];
  cinematographyApprovals?: string[];
};

export function InventoryWorkspace({ boundary, record, busy = false, onRunBreakdown, onChange, visualApprovals = [], cinematographyApprovals = [] }: InventoryWorkspaceProps) {
  const [category, setCategory] = useState<"all" | ProductionCategory>("all");
  const [preflightFilter, setPreflightFilter] = useState<PreflightFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (!boundary) return <ApprovalGate />;
  if (!record) {
    return (
      <EmptyBreakdown boundary={boundary} busy={busy} onRunBreakdown={onRunBreakdown} />
    );
  }

  const versionChanged = record.screenplayVersionId !== boundary.screenplayVersionId;
  const preflight = breakdownPreflight(record);
  const categoryAssets = filterInventoryAssets(record, { category, readiness: "all", query });
  const assets = preflightFilter === "all" ? categoryAssets : categoryAssets.filter((asset) => PREFLIGHT_STATES[preflightFilter].includes(asset.readiness));
  const visibleIds = new Set(assets.map((asset) => asset.id));
  const cards = inventoryCards(record, { category, readiness: "all", query }).filter((card) => visibleIds.has(card.id));
  const selected = record.assets.find((asset) => asset.id === selectedId) ?? null;
  const queueCounts = record.queue.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-bg">
      <header className="shrink-0 border-b border-border px-4 pb-3 pt-4 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] tracking-wide text-subtle uppercase">04 · Inventory</p>
            <h2 className="mt-1 font-display text-3xl tracking-tight">Inventory</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              Canonical, engine-independent production assets linked to approved screenplay {record.screenplayVersionId}.
            </p>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
            <Button variant="secondary" onClick={() => setAdding(true)}><Plus /> Add asset</Button>
            {versionChanged ? <Button disabled={busy} onClick={() => void onRunBreakdown(boundary)}>{busy ? "Reconciling…" : "Reconcile breakdown"}</Button> : <Button disabled={busy} onClick={() => onChange(prepareAssetQueue(record))}>{record.queue.length ? "Refresh preparation" : "Prepare queue"}</Button>}
          </div>
        </div>
        {versionChanged ? (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-elevated px-3 py-2 text-xs text-muted shadow-[var(--shadow-border)]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" />
            <p>The approved screenplay changed. Reconcile affected scenes before preparing new asset work.</p>
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-6">
        <PreflightSummary
          record={record}
          total={preflight.total}
          ready={preflight.ready}
          review={preflight.needReview}
          blocked={preflight.blocked}
          onCategory={setCategory}
          onReadiness={setPreflightFilter}
        />

        <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-1 overflow-x-auto pb-1" aria-label="Asset categories">
            <FilterButton active={category === "all"} onClick={() => setCategory("all")}>All</FilterButton>
            {PRODUCTION_CATEGORIES.map((item) => (
              <FilterButton key={item} active={category === item} onClick={() => setCategory(item)}>
                {PRODUCTION_CATEGORY_LABELS[item]}
              </FilterButton>
            ))}
          </div>
          <label className="relative block w-full shrink-0 xl:w-64">
            <span className="sr-only">Search inventory</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-subtle" />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search inventory" />
          </label>
        </div>

        {preflightFilter !== "all" ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted">
            <ListFilter className="size-4" />
            <span>{preflightFilter === "review" ? "Needs review" : preflightFilter}</span>
            <button className="inline-flex size-9 items-center justify-center rounded-sm hover:bg-elevated" type="button" onClick={() => setPreflightFilter("all")} aria-label="Clear readiness filter"><X className="size-4" /></button>
          </div>
        ) : null}

        {cards.length ? (
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3">
            {cards.map((card) => {
              const asset = assets.find((item) => item.id === card.id)!;
              return <div key={card.id} className="grid content-start gap-2"><AssetCard asset={asset} sceneLabels={card.sceneLabels} previewUri={card.previewUri} selected={card.id === selectedId} onClick={() => setSelectedId(card.id)} /><AssetReferenceUpload record={record} assetId={asset.id} onChange={onChange} disabled={busy} /></div>;
            })}
          </div>
        ) : (
          <div className="mt-8 grid min-h-48 place-items-center rounded-lg bg-inset p-6 text-center shadow-[var(--shadow-border)]">
            <div><Boxes className="mx-auto size-5 text-subtle" /><p className="mt-2 text-sm">No assets match this view.</p><p className="mt-1 text-xs text-muted">Clear a filter or add the missing production element.</p></div>
          </div>
        )}

        {record.queue.length ? <QueueSummary counts={queueCounts} total={record.queue.length} /> : null}
        <PreparedAssetsPanel record={record} visualApprovals={visualApprovals} cinematographyApprovals={cinematographyApprovals} onChange={onChange} />
      </div>

      {selected ? <AssetInspector record={record} asset={selected} onChange={onChange} onClose={() => setSelectedId(null)} /> : null}
      {adding ? <AddAssetDialog record={record} onChange={(next) => { onChange(next); setAdding(false); }} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function ApprovalGate() {
  return (
    <div className="grid h-full min-h-64 place-items-center bg-bg p-6 text-center">
      <div className="max-w-md">
        <AlertTriangle className="mx-auto size-5 text-accent" />
        <p className="mt-3 text-[11px] tracking-wide text-subtle uppercase">Approval required</p>
        <h2 className="mt-1 font-display text-2xl tracking-tight">Approve the screenplay first</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">Production breakdown only uses the immutable approved version. Working drafts never overwrite canonical assets.</p>
      </div>
    </div>
  );
}

function EmptyBreakdown({ boundary, busy, onRunBreakdown }: { boundary: ApprovedScreenplayBoundary; busy: boolean; onRunBreakdown: InventoryWorkspaceProps["onRunBreakdown"] }) {
  return (
    <div className="grid h-full min-h-64 min-w-0 place-items-center overflow-hidden bg-bg p-4 text-center sm:p-6">
      <div className="w-full max-w-lg min-w-0 overflow-hidden rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)] sm:p-6">
        <Boxes className="mx-auto size-5 text-accent" />
        <p className="mt-3 text-[11px] tracking-wide text-subtle uppercase">Approved screenplay ready</p>
        <h2 className="mt-1 font-display text-2xl tracking-tight">Build the production inventory</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">Extract and normalize characters, locations, wardrobe, props, effects, voices, sound, and continuity from {boundary.scenes.length} approved scenes.</p>
        <Button className="mt-5" disabled={busy} onClick={() => void onRunBreakdown(boundary)}>{busy ? "Breaking down…" : "Run production breakdown"}</Button>
        <p className="mt-3 text-xs text-subtle">Preparation only. No media will be generated.</p>
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={cn("min-h-11 shrink-0 rounded-sm px-3 text-xs transition-colors", active ? "bg-elevated text-fg shadow-[var(--shadow-border)]" : "text-muted hover:text-fg")} onClick={onClick}>{children}</button>;
}

function AssetCard({ asset, sceneLabels, previewUri, selected, onClick }: { asset: ProductionAsset; sceneLabels: string[]; previewUri: string | null; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cn("min-w-0 overflow-hidden rounded-lg bg-elevated text-left shadow-[var(--shadow-border)] transition-[box-shadow,transform] hover:shadow-[var(--shadow-border-hover)] active:scale-[0.99]", selected && "ring-1 ring-accent/60")} onClick={onClick}>
      <div className="aspect-video bg-inset">
        {previewUri ? <img src={previewUri} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><ImageOff className="size-5 text-subtle" /></div>}
      </div>
      <div className="p-3">
        <div className="flex min-w-0 items-start justify-between gap-2"><h3 className="min-w-0 truncate text-sm" title={asset.name}>{asset.name}</h3><ReadinessBadge readiness={asset.readiness} /></div>
        <p className="mt-1 text-[10px] tracking-wide text-subtle uppercase">{PRODUCTION_CATEGORY_LABELS[asset.category]}</p>
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{asset.canonicalSpec.visualDescription || "Canonical specification not prepared."}</p>
        <p className="mt-2 truncate text-[10px] text-subtle" title={sceneLabels.join(" · ")}>{asset.requiredSceneIds.length} scenes · {asset.variants.length} variants</p>
      </div>
    </button>
  );
}

function PreflightSummary({ record, total, ready, review, blocked, onCategory, onReadiness }: { record: ProductionBreakdown; total: number; ready: number; review: number; blocked: number; onCategory: (category: "all" | ProductionCategory) => void; onReadiness: (state: PreflightFilter) => void }) {
  const major: ProductionCategory[] = ["character", "location", "prop", "wardrobe", "vfx"];
  const characterAssets = record.assets.filter((asset) => asset.category === "character");
  const characterAssetsWithImages = characterAssets.filter((asset) => asset.iterations.some((iteration) => iteration.mediaUri && iteration.status !== "REJECTED"));
  const missingCharacterImages = characterAssets.filter((asset) => !characterAssetsWithImages.includes(asset));
  return (
    <section className="rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]" aria-label="Breakdown preflight">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[11px] tracking-wide text-subtle uppercase">Breakdown preflight</p><p className="mt-0.5 text-sm"><span className="font-display text-xl tabular-nums">{total}</span> production elements</p></div><div className="flex flex-wrap gap-1.5"><SummaryButton label="Ready" count={ready} onClick={() => onReadiness("ready")} /><SummaryButton label="Need review" count={review} onClick={() => onReadiness("review")} /><SummaryButton label="Blocked" count={blocked} onClick={() => onReadiness("blocked")} /></div></div>
      <div className="mt-3 rounded-md bg-inset px-3 py-2 text-xs shadow-[var(--shadow-border)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p><span className="text-fg tabular-nums">{characterAssetsWithImages.length}/{characterAssets.length}</span> character images attached</p>
          <button type="button" className="min-h-9 rounded-sm px-2 text-muted hover:bg-elevated hover:text-fg" onClick={() => onCategory("character")}>View characters</button>
        </div>
        {missingCharacterImages.length ? (
          <p className="mt-1 text-rec">Missing: {missingCharacterImages.map((asset) => `${asset.name} (${asset.id})`).join(", ")}</p>
        ) : (
          <p className="mt-1 text-muted">No character image is missing in the current workbook import.</p>
        )}
      </div>
      <div className="mt-3 flex gap-1 overflow-x-auto border-t border-border pt-2">{major.map((item) => <button key={item} type="button" className="min-h-11 shrink-0 rounded-sm px-3 py-2 text-[11px] text-muted hover:bg-inset hover:text-fg" onClick={() => onCategory(item)}><span className="text-fg tabular-nums">{record.assets.filter((asset) => asset.category === item).length}</span> {PRODUCTION_CATEGORY_LABELS[item]}</button>)}</div>
    </section>
  );
}

function SummaryButton({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return <button type="button" className="min-h-11 rounded-sm bg-inset px-3 py-2 text-[11px] text-muted shadow-[var(--shadow-border)] hover:text-fg" onClick={onClick}><span className="text-fg tabular-nums">{count}</span> {label}</button>;
}

function QueueSummary({ counts, total }: { counts: Record<string, number>; total: number }) {
  return (
    <section className="mt-6 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[11px] tracking-wide text-subtle uppercase">Asset preparation queue</p><p className="mt-1 text-sm">{total} records saved</p></div><Badge>No automatic generation</Badge></div>
      <dl className="mt-3 flex flex-wrap gap-2">{Object.entries(counts).map(([status, count]) => <div key={status} className="rounded-sm bg-inset px-2.5 py-2"><dt className="text-[10px] text-subtle">{status.replaceAll("_", " ")}</dt><dd className="mt-0.5 text-sm tabular-nums">{count}</dd></div>)}</dl>
    </section>
  );
}
