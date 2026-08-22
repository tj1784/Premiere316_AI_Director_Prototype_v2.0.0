import React, { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../store";
import { openAssetAction, useAssetActionStore } from "../contextual-agency";

const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
const CATEGORY_ORDER = ["character", "wardrobe", "location", "artifact", "extra", "atmosphere", "guide-frame", "graphic"];
const CATEGORY_LABELS: Record<string, string> = {
  character: "Characters",
  wardrobe: "Wardrobe",
  location: "Locations",
  artifact: "Props & Artifacts",
  extra: "Crowds & Creatures",
  atmosphere: "Atmosphere & VFX",
  "guide-frame": "Guide Frames",
  graphic: "Graphics"
};
const CATEGORY_ICONS: Record<string, string> = {
  character: "◉",
  wardrobe: "♢",
  location: "⌂",
  artifact: "◆",
  extra: "◌",
  atmosphere: "✦",
  "guide-frame": "▣",
  graphic: "T"
};
const MAX_REFERENCES = 9;
const ROLE_OPTIONS = ["identity", "wardrobe", "location", "prop", "crowd", "atmosphere"];
const ROLE_ALIASES: Record<string, string> = {
  identity: "identity", character: "identity", face: "identity", actor: "identity",
  wardrobe: "wardrobe", costume: "wardrobe", clothing: "wardrobe",
  location: "location", environment: "location", set: "location", composition: "location",
  prop: "prop", artifact: "prop", vehicle: "prop",
  crowd: "crowd", crowds: "crowd", extra: "crowd", extras: "crowd", creature: "crowd",
  atmosphere: "atmosphere", atmosphere_vfx: "atmosphere", vfx: "atmosphere", lighting: "atmosphere", style: "atmosphere"
};
const DEFAULT_ROLE: Record<string, string> = {
  character: "identity",
  wardrobe: "wardrobe",
  location: "location",
  artifact: "prop",
  extra: "crowd",
  atmosphere: "atmosphere",
  "guide-frame": "location",
  graphic: "atmosphere"
};

function canonicalReferenceRole(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ROLE_ALIASES[normalized] || null;
}

type DraftReference = {
  id?: string;
  assetId: string;
  assetVersion: number;
  role: string;
  useMode: string;
  required: boolean;
  cropRegion: string;
  notes: string;
  pinnedActiveAtImport: boolean;
};

function versionFile(version: any) {
  return version?.file || version?.files?.find((file: string) => IMAGE_FILE_RE.test(String(file || ""))) || null;
}

function visualVersions(asset: any) {
  return (asset?.versions || []).filter((version: any) => IMAGE_FILE_RE.test(String(versionFile(version) || "")));
}

function exactVersionApproved(asset: any, version: number) {
  return Boolean(asset?.approvalCurrent === true && asset?.approval?.status === "approved" && Number(asset.approval.activeVersion) === Number(version));
}

function AssetThumbnail({ projectSlug, asset, version }: { projectSlug: string; asset: any; version: number }) {
  const [failed, setFailed] = useState(false);
  const selectedVersion = visualVersions(asset).find((item: any) => Number(item.v) === Number(version));
  const file = versionFile(selectedVersion);
  if (!file || failed) {
    return <div className="reference-thumb-placeholder"><span>{CATEGORY_ICONS[asset?.category] || "◇"}</span><small>Preview unavailable</small></div>;
  }
  return <img src={assetUrl(projectSlug, file)} alt="" onError={() => setFailed(true)} />;
}

export default function AssetReferencePicker({
  project,
  targetLabel,
  targetId,
  targetKind = "frame",
  initialReferences,
  saving,
  onCancel,
  onApply
}: {
  project: any;
  targetLabel: string;
  targetId?: string;
  targetKind?: string;
  initialReferences: any[];
  saving: boolean;
  onCancel: () => void;
  onApply: (references: DraftReference[]) => Promise<void>;
}) {
  const lastResult = useAssetActionStore((state) => state.lastResult);
  const consumedResult = React.useRef<string | null>(null);

  const assets = useMemo(() => (project.assets?.items || [])
    .filter((asset: any) => visualVersions(asset).length)
    .slice()
    .sort((a: any, b: any) => {
      const categoryDifference = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
      return categoryDifference || String(a.name).localeCompare(String(b.name));
    }), [project.assets?.items]);
  const assetMap = useMemo(() => new Map((project.assets?.items || []).map((asset: any) => [asset.id, asset])), [project.assets?.items]);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState<DraftReference[]>(() => initialReferences
    .filter((reference) => reference?.assetId && assetMap.has(reference.assetId))
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((reference) => {
      const asset = assetMap.get(reference.assetId) as any;
      const assetVersion = Number(reference.assetVersion ?? String(reference.assetVersionId || "").match(/v(\d+)$/)?.[1] ?? 0);
      return {
        id: reference.id ? String(reference.id) : undefined,
        assetId: reference.assetId,
        assetVersion,
        role: canonicalReferenceRole(reference.role) || DEFAULT_ROLE[asset?.category] || "atmosphere",
        useMode: String(reference.useMode || "direct_conditioning"),
        required: reference.required !== false,
        cropRegion: String(reference.cropRegion || "Use relevant subject/design region only"),
        notes: String(reference.notes || "Pinned to an exact Asset Library version for reproducible generation."),
        pinnedActiveAtImport: typeof reference.pinnedActiveAtImport === "boolean"
          ? reference.pinnedActiveAtImport
          : Number(asset?.activeVersion) === assetVersion
      };
    }));
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(onCancel);
  const busyRef = useRef(saving || applying);
  cancelRef.current = onCancel;
  busyRef.current = saving || applying;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => searchRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  const categories = useMemo(() => CATEGORY_ORDER.map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    count: assets.filter((asset: any) => asset.category === key).length
  })).filter((item) => item.count), [assets]);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = assets.filter((asset: any) => {
    if (category !== "all" && asset.category !== category) return false;
    if (!normalizedQuery) return true;
    return `${asset.name} ${asset.variant} ${asset.id}`.toLowerCase().includes(normalizedQuery);
  });
  const selectedIds = useMemo(() => new Set(draft.map((reference) => reference.assetId)), [draft]);
  const referenceLimitReached = draft.length >= MAX_REFERENCES;

  const toggleAsset = (asset: any) => {
    setDraft((current) => {
      if (current.some((reference) => reference.assetId === asset.id)) return current.filter((reference) => reference.assetId !== asset.id);
      if (current.length >= MAX_REFERENCES) return current;
      const versions = visualVersions(asset);
      const active = versions.find((version: any) => Number(version.v) === Number(asset.activeVersion)) || versions.at(-1);
      return [...current, {
        assetId: asset.id,
        assetVersion: Number(active?.v || 1),
        role: DEFAULT_ROLE[asset.category] || "atmosphere",
        useMode: "direct_conditioning",
        required: true,
        cropRegion: "Use relevant subject/design region only",
        notes: "Selected in the Storyboard reference picker and pinned for reproducible generation.",
        pinnedActiveAtImport: Number(asset.activeVersion) === Number(active?.v || 1)
      }];
    });
  };

  React.useEffect(() => {
    if (!lastResult?.assetId || consumedResult.current === lastResult.assetId) return;
    const asset = (project.assets?.items || []).find((item: any) => item.id === lastResult.assetId);
    if (!asset) return;
    consumedResult.current = lastResult.assetId;
    setDraft((current) => {
      if (current.some((reference) => reference.assetId === asset.id)) return current;
      return [...current, {
        assetId: asset.id,
        assetVersion: Number(lastResult.version || asset.activeVersion || 1),
        role: DEFAULT_ROLE[asset.category] || "identity",
        useMode: "direct_conditioning",
        required: true,
        cropRegion: "Use relevant subject/design region only",
        notes: "Returned from the contextual asset drawer with a role pinned.",
        pinnedActiveAtImport: Number(asset.activeVersion) === Number(lastResult.version || asset.activeVersion || 1)
      }];
    });
  }, [lastResult?.assetId, lastResult?.version, project.assets?.items]);

  const openMissing = (action: "create" | "generate" | "upload") => {
    const categoryKey = category === "all" ? "location" : category;
    openAssetAction({
      sourceRoute: "/storyboard",
      sourceEntity: { type: "storyboard-frame", id: targetId || targetLabel, label: targetLabel },
      requirement: {
        relationship: "storyboardFrame.locationReference",
        category: categoryKey as any,
        expectedMediaType: "image"
      },
      initialAction: action,
      returnFocusId: "reference-asset-search"
    });
  };

    const updateDraft = (assetId: string, patch: Partial<DraftReference>) => {
    setDraft((current) => current.map((reference) => reference.assetId === assetId ? { ...reference, ...patch } : reference));
  };

  const apply = async () => {
    if (applying || saving) return;
    setApplying(true);
    try {
      await onApply(draft);
      onCancel();
    } catch {
      // The project store surfaces the API error without discarding the draft.
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="reference-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving && !applying) onCancel(); }}>
      <div ref={dialogRef} className="reference-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="reference-picker-title" aria-describedby="reference-picker-description">
        <header className="reference-picker-header">
          <div>
            <p className="eyebrow">STORYBOARD REFERENCES</p>
            <h2 id="reference-picker-title">Add visual references</h2>
            <p id="reference-picker-description">{targetLabel} · choose exact Asset Library versions and their conditioning roles.</p>
          </div>
          <button type="button" className="asset-dialog-close" aria-label="Close reference picker" onClick={onCancel} disabled={saving || applying}>×</button>
        </header>

        <div className="reference-picker-body">
          <aside className="reference-picker-categories" aria-label="Asset categories">
            <button type="button" className={category === "all" ? "active" : ""} aria-pressed={category === "all"} onClick={() => setCategory("all")}><span>▦</span><b>All Visual Assets</b><em>{assets.length}</em></button>
            {categories.map((item) => <button type="button" key={item.key} className={category === item.key ? "active" : ""} aria-pressed={category === item.key} onClick={() => setCategory(item.key)}><span>{CATEGORY_ICONS[item.key]}</span><b>{item.label}</b><em>{item.count}</em></button>)}
          </aside>

          <section className="reference-picker-library">
            <div className="reference-picker-search">
              <label htmlFor="reference-asset-search">Search production assets</label>
              <input ref={searchRef} id="reference-asset-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, variant, or asset ID…" />
              <span aria-live="polite">{visible.length} shown · {draft.length}/{MAX_REFERENCES} selected{referenceLimitReached ? ` · Maximum ${MAX_REFERENCES} reached` : ""}</span>
            </div>
            <div className="reference-picker-grid" role="listbox" aria-label="Available visual assets" aria-multiselectable="true">
              {visible.map((asset: any) => {
                const selected = selectedIds.has(asset.id);
                const selectedDraft = draft.find((reference) => reference.assetId === asset.id);
                const versions = visualVersions(asset);
                const version = selectedDraft?.assetVersion || Number(asset.activeVersion || versions.at(-1)?.v || 1);
                return (
                  <button type="button" role="option" aria-selected={selected} key={asset.id} className={`reference-asset-card ${selected ? "selected" : ""}`} onClick={() => toggleAsset(asset)} disabled={!selected && referenceLimitReached} aria-disabled={!selected && referenceLimitReached} title={!selected && referenceLimitReached ? `Remove a reference before adding another (maximum ${MAX_REFERENCES}).` : undefined}>
                    <span className="reference-asset-preview"><AssetThumbnail projectSlug={project.slug} asset={asset} version={version} /><i aria-hidden="true">{selected ? "✓" : ""}</i></span>
                    <span className="reference-asset-copy"><b>{asset.name}</b><small>{asset.variant}</small><code>{asset.id}</code></span>
                    <span className={`reference-approval ${exactVersionApproved(asset, version) ? "approved" : "review"}`}>{exactVersionApproved(asset, version) ? `Approved v${version}` : `Needs approval · v${version}`}</span>
                  </button>
                );
              })}
              {!visible.length ? (
                <div className="reference-picker-empty">
                  <p>No visual assets match this category and search.</p>
                  <div className="reference-picker-empty-actions">
                    <button type="button" className="primary-action" onClick={() => openMissing("create")}>Create asset</button>
                    <button type="button" className="secondary-action" onClick={() => openMissing("generate")}>Generate asset</button>
                    <button type="button" className="secondary-action" onClick={() => openMissing("upload")}>Upload asset</button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="reference-picker-tray" aria-label="Selected references">
            <header><div><p className="eyebrow">SELECTED</p><h3>{draft.length} reference{draft.length === 1 ? "" : "s"}</h3></div>{draft.length ? <button type="button" onClick={() => setDraft([])}>Clear all</button> : null}</header>
            <div className="reference-picker-tray-list">
              {draft.map((reference, index) => {
                const asset = assetMap.get(reference.assetId) as any;
                if (!asset) return null;
                return (
                  <article key={reference.assetId} className="reference-tray-item">
                    <div className="reference-tray-heading"><span>{index + 1}</span><div><b>{asset.name}</b><small>{asset.variant}</small></div><button type="button" aria-label={`Remove ${asset.name}`} onClick={() => setDraft((current) => current.filter((item) => item.assetId !== reference.assetId))}>×</button></div>
                    <div className="reference-tray-fields">
                      <label>Version<select value={reference.assetVersion} onChange={(event) => { const assetVersion = Number(event.target.value); updateDraft(reference.assetId, { assetVersion, pinnedActiveAtImport: Number(asset.activeVersion) === assetVersion }); }}>{visualVersions(asset).map((version: any) => <option key={version.v} value={version.v}>v{version.v}{Number(asset.activeVersion) === Number(version.v) ? " · active" : " · historical"}</option>)}</select></label>
                      <label>Role<select value={reference.role} onChange={(event) => updateDraft(reference.assetId, { role: event.target.value })}>{ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
                    </div>
                  </article>
                );
              })}
              {!draft.length ? <div className="reference-tray-empty"><span>＋</span><p>Select assets from any category. They will appear here with version and role controls.</p></div> : null}
            </div>
          </aside>
        </div>

        <footer className="reference-picker-footer">
          <p>{referenceLimitReached ? `Maximum ${MAX_REFERENCES} references selected. Remove one to choose another.` : `Choose up to ${MAX_REFERENCES} planning references. Video generation remains locked until required images and exact asset versions are approved.`}</p>
          <button type="button" className="secondary-action" onClick={onCancel} disabled={saving || applying}>Cancel</button>
          <button type="button" className="primary-action" onClick={() => void apply()} disabled={saving || applying}>{saving || applying ? "Applying…" : `Apply ${draft.length} Reference${draft.length === 1 ? "" : "s"}`}</button>
        </footer>
      </div>
    </div>
  );
}
