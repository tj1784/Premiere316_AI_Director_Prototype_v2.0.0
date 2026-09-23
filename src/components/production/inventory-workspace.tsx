import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Boxes, ChevronLeft, ChevronRight, ImageOff, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  PRODUCTION_CATEGORIES,
  breakdownPreflight,
  filterInventoryAssets,
  inventoryCards,
  prepareAssetQueue,
  type AssetReadiness,
  type ProductionBreakdown,
  type ProductionCategory,
} from "@/lib/production";
import type { ApprovedScreenplayBoundary } from "@/lib/studio/screenplay";
import { AssetInspector } from "./asset-inspector";
import { AddAssetDialog } from "./inventory-dialogs";
import "./inventory-inline.css";
import { PRODUCTION_CATEGORY_LABELS } from "./inventory-constants";
import { ReadinessBadge } from "./inventory-primitives";
import { PreparedAssetsPanel } from "./prepared-assets-panel";

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
  const [view, setView] = useState<"assets" | "preparation">("assets");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const railRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    const item = [...(railRef.current?.querySelectorAll<HTMLElement>("[data-inventory-id]") ?? [])]
      .find((node) => node.dataset.inventoryId === selectedId);
    item?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [selectedId]);

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
  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0] ?? null;
  const selectedCard = cards.find((card) => card.id === selected?.id);
  const selectedIndex = cards.findIndex((card) => card.id === selected?.id);
  const queueCounts = record.queue.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const chooseAsset = (id: string) => {
    setSelectedId(id);
    setAdding(false);
    setView("assets");
    setInspectorOpen(true);
  };
  const moveSelection = (direction: number) => {
    if (!cards.length) return;
    const index = (selectedIndex + direction + cards.length) % cards.length;
    chooseAsset(cards[index]!.id);
  };

  return (
    <section className={"inventory-cinema" + (view === "assets" && !adding && !inspectorOpen ? " inspector-closed" : "")} aria-label="Production inventory">
      <div className="inventory-cinema-backdrop" aria-hidden="true">
        {selectedCard?.previewUri ? <img key={selected?.id} src={selectedCard.previewUri} alt="" /> : null}
      </div>

      <header className="inventory-cinema-toolbar">
        <div className="inventory-cinema-heading">
          <p>04 · Production inventory</p>
          <h2>Assets</h2>
        </div>
        <div className="inventory-cinema-view" role="group" aria-label="Inventory view">
          <button type="button" aria-pressed={view === "assets"} onClick={() => setView("assets")}>Library</button>
          <button type="button" aria-pressed={view === "preparation"} onClick={() => { setAdding(false); setView("preparation"); }}>Preparation</button>
        </div>
        <div className="inventory-cinema-actions">
          <Button variant="secondary" onClick={() => { setAdding(true); setInspectorOpen(true); setView("assets"); }}><Plus /> Add asset</Button>
          {versionChanged
            ? <Button disabled={busy} onClick={() => void onRunBreakdown(boundary)}>{busy ? "Reconciling…" : "Reconcile breakdown"}</Button>
            : <Button disabled={busy} onClick={() => { onChange(prepareAssetQueue(record)); setAdding(false); setView("preparation"); }}>{record.queue.length ? "Refresh preparation" : "Prepare queue"}</Button>}
        </div>
      </header>

      <div className="inventory-cinema-filterbar">
        <label className="inventory-cinema-category">
          <span className="sr-only">Asset category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as "all" | ProductionCategory)}>
            <option value="all">All categories · {record.assets.filter((asset) => !asset.tombstone).length}</option>
            {PRODUCTION_CATEGORIES.map((item) => <option key={item} value={item}>{PRODUCTION_CATEGORY_LABELS[item]} · {record.assets.filter((asset) => !asset.tombstone && asset.category === item).length}</option>)}
          </select>
        </label>
        <label className="inventory-cinema-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search production assets</span>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets" />
        </label>
        <PreflightSummary record={record} total={preflight.total} ready={preflight.ready} review={preflight.needReview} blocked={preflight.blocked} filter={preflightFilter} onCategory={setCategory} onReadiness={setPreflightFilter} />
      </div>

      <div className="inventory-cinema-hero" aria-live="polite">
        {selected ? <>
          <p className="inventory-cinema-eyebrow">{PRODUCTION_CATEGORY_LABELS[selected.category]} · {selected.requiredSceneIds.length} scenes · {selected.variants.length} states</p>
          <h3>{selected.name}</h3>
          <p className="inventory-cinema-description">{selected.canonicalSpec.visualDescription || "Canonical specification awaits review."}</p>
          <ReadinessBadge readiness={selected.readiness} />
          {!selectedCard?.previewUri ? <p className="inventory-cinema-no-image"><ImageOff size={15} /> No asset image or reference attached</p> : null}
        </> : <>
          <Boxes size={26} />
          <h3>No matching assets</h3>
          <p className="inventory-cinema-description">Change the search or filter to find a production element.</p>
        </>}
        {versionChanged ? <p className="inventory-cinema-warning"><AlertTriangle size={16} /> The approved screenplay changed. Reconcile the affected scenes before new preparation.</p> : null}
      </div>

      <section className="inventory-cinema-rail" aria-label="Production asset carousel">
        <div className="inventory-cinema-rail-heading">
          <span>{cards.length} production assets</span>
          <div className="inventory-cinema-rail-arrows">
            <button type="button" aria-label="Previous asset" disabled={!cards.length} onClick={() => moveSelection(-1)}><ChevronLeft size={18} /></button>
            <button type="button" aria-label="Next asset" disabled={!cards.length} onClick={() => moveSelection(1)}><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="inventory-cinema-rail-track" ref={railRef} key={category + preflightFilter + query}>
          {cards.map((card) => <AssetTile key={card.id} id={card.id} name={card.name} category={card.category} previewUri={card.previewUri} selected={card.id === selected?.id} onClick={() => chooseAsset(card.id)} />)}
          {!cards.length ? <p className="inventory-cinema-empty">No results. Clear your filters or add an asset.</p> : null}
        </div>
      </section>

      <div className="inventory-cinema-inspector">
        {view === "preparation" ? <div className="inventory-preparation-pane">
          <div className="inventory-preparation-heading"><p>Production gate</p><h3>Preparation</h3><span>Screenplay version {record.screenplayVersionId}</span></div>
          {record.queue.length ? <QueueSummary counts={queueCounts} total={record.queue.length} /> : <p className="inventory-preparation-empty">No preparation queue has been created.</p>}
          <PreparedAssetsPanel record={record} visualApprovals={visualApprovals} cinematographyApprovals={cinematographyApprovals} onChange={onChange} />
        </div> : adding ? <AddAssetDialog record={record} onChange={(next) => {
          const added = next.assets.find((asset) => !record.assets.some((previous) => previous.id === asset.id));
          onChange(next);
          setAdding(false);
          if (added) setSelectedId(added.id);
        }} onClose={() => setAdding(false)} /> : selected
          ? inspectorOpen ? <AssetInspector key={selected.id} record={record} asset={selected} onChange={onChange} onClose={() => {
              setInspectorOpen(false);
              requestAnimationFrame(() => railRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus());
            }} /> : null
          : <div className="inventory-cinema-inspector-empty">Select an asset to inspect its canonical specification and references.</div>}
      </div>
    </section>
  );
}

function ApprovalGate() {
  return (
    <div className="inventory-cinema-gate">
      <div>
        <AlertTriangle className="mx-auto size-5 text-accent" />
        <p className="inventory-cinema-eyebrow">Production gate</p>
        <h2>Approve the screenplay first</h2>
        <p>Production breakdown uses the approved version. Working drafts never overwrite canonical assets.</p>
      </div>
    </div>
  );
}

function EmptyBreakdown({ boundary, busy, onRunBreakdown }: { boundary: ApprovedScreenplayBoundary; busy: boolean; onRunBreakdown: InventoryWorkspaceProps["onRunBreakdown"] }) {
  return (
    <div className="inventory-cinema-gate">
      <div>
        <Boxes className="mx-auto size-5 text-accent" />
        <p className="inventory-cinema-eyebrow">Approved screenplay ready</p>
        <h2>Build the production inventory</h2>
        <p>Extract characters, locations, wardrobe, props, effects, voices, sound, and continuity from {boundary.scenes.length} approved scenes.</p>
        <Button disabled={busy} onClick={() => void onRunBreakdown(boundary)}>{busy ? "Breaking down…" : "Run production breakdown"}</Button>
        <small>Preparation only. No media will be generated.</small>
      </div>
    </div>
  );
}

function AssetTile({ id, name, category, previewUri, selected, onClick }: { id: string; name: string; category: ProductionCategory; previewUri: string | null; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" data-inventory-id={id} className="inventory-cinema-tile" aria-pressed={selected} aria-label={"Select " + name} onClick={onClick}>
      <div className="inventory-cinema-tile-media">
        {previewUri ? <img src={previewUri} alt="" loading="lazy" decoding="async" /> : <ImageOff size={22} aria-hidden="true" />}
      </div>
      <span className="inventory-cinema-tile-name" title={name}>{name}</span>
      <span className="inventory-cinema-tile-category">{PRODUCTION_CATEGORY_LABELS[category]}</span>
    </button>
  );
}

function PreflightSummary({ record, total, ready, review, blocked, filter, onCategory, onReadiness }: { record: ProductionBreakdown; total: number; ready: number; review: number; blocked: number; filter: PreflightFilter; onCategory: (category: "all" | ProductionCategory) => void; onReadiness: (state: PreflightFilter) => void }) {
  const characterAssets = record.assets.filter((asset) => asset.category === "character" && !asset.tombstone);
  const characterAssetsWithImages = characterAssets.filter((asset) => asset.iterations.some((iteration) => (iteration.mediaUri || iteration.previewUri) && iteration.status !== "REJECTED") || asset.references.some((reference) => reference.uri || reference.previewUri));
  const missingCharacterImages = characterAssets.filter((asset) => !characterAssetsWithImages.includes(asset));
  return (
    <section className="inventory-cinema-preflight" aria-label="Breakdown preflight">
      <SummaryButton label="All" count={total} active={filter === "all"} onClick={() => onReadiness("all")} />
      <SummaryButton label="Ready" count={ready} active={filter === "ready"} onClick={() => onReadiness("ready")} />
      <SummaryButton label="Review" count={review} active={filter === "review"} onClick={() => onReadiness("review")} />
      <SummaryButton label="Blocked" count={blocked} active={filter === "blocked"} onClick={() => onReadiness("blocked")} />
      <details className="inventory-cinema-media-status">
        <summary>{characterAssetsWithImages.length}/{characterAssets.length} character images</summary>
        <div>
          <button type="button" onClick={() => onCategory("character")}>Show characters</button>
          {missingCharacterImages.length
            ? <p>Missing: {missingCharacterImages.map((asset) => asset.name + " (" + asset.id + ")").join(", ")}</p>
            : <p>All character assets have an image or reference attached.</p>}
        </div>
      </details>
    </section>
  );
}

function SummaryButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick}><strong>{count}</strong> {label}</button>;
}

function QueueSummary({ counts, total }: { counts: Record<string, number>; total: number }) {
  return (
    <section className="inventory-preparation-queue">
      <h4>Queue · {total} records</h4>
      <p>No automatic generation</p>
      <dl>{Object.entries(counts).map(([status, count]) => <div key={status}><dt>{status.replaceAll("_", " ")}</dt><dd>{count}</dd></div>)}</dl>
    </section>
  );
}
