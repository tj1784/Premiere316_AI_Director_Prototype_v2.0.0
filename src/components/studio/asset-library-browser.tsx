import "./asset-workbench.css";
import { CabinetCarousel } from "./cabinet";
import { openCharacterSheet, openWorldSheet } from "./workspace-links";
import { AssetImagePreview } from "./asset-image-preview";
import { useEffect, useState, type ReactNode } from "react";
import { ImageOff, Maximize2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { deleteUnselectedImageIteration, imageIterationDeletionEligibility, type ProductionAsset, type GeneratedIteration } from "@/lib/production";
import type { Picture } from "@/lib/studio/types";
import { useStudio } from "@/lib/studio/store";
import { ASSET_REVIEW_GROUPS, assetReviewGroup } from "@/lib/studio/asset-review-categories";
import { AssetReferenceUpload } from "../production/asset-reference-upload";
import { AssetInspector } from "../production/asset-inspector";
import { CharacterVoiceSamples } from "./character-voice-samples";
import { ImageIterationReview } from "./image-iteration-review";
import { useWorkspaceDraft } from "./use-workspace-draft";

type AssetReview = {
  asset: ProductionAsset;
  prompt: string;
  sourceCurrent: boolean;
  current?: GeneratedIteration;
  latest?: GeneratedIteration;
};
const NO_ITERATION_SELECTED = "__asset_no_iteration_selected__";
const displayIterationKey = (assetId: string) => `asset-display-iteration:${assetId}`;

/** Search the terms actually attached to the production record; assets have no dedicated tags field. */
function assetSearchText(asset: ProductionAsset, picture: Picture): string {
  const spec = asset.canonicalSpec;
  const scenes = picture.production?.scenes ?? [];
  return [
    asset.id, asset.name, asset.category, ...asset.aliases,
    spec.identity, spec.visualDescription, spec.appearance, spec.age, spec.facialGeometry,
    spec.build, spec.hair, spec.skin, spec.wardrobe, spec.visualStyle, spec.period,
    spec.geography, spec.architecture, spec.lighting, spec.weather, spec.timeOfDay,
    spec.scale, spec.performanceNotes, ...spec.distinguishingFeatures, ...spec.materials,
    ...spec.setDressing, ...spec.continuityLocks, ...(spec.referenceRequirements ?? []),
    ...asset.variants.map((variant) => variant.name),
    ...asset.references.map((reference) => reference.name),
    ...scenes.filter((scene) => asset.requiredSceneIds.includes(scene.id)).map((scene) => scene.slugline),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function matchesAssetStatus(asset: ProductionAsset, status: string): boolean {
  switch (status) {
    case "approved": return Boolean(asset.approvedIterationId);
    case "pending": return !asset.approvedIterationId;
    case "draft": return asset.iterations.some((iteration) => iteration.status === "GENERATED" || iteration.status === "NEEDS_REVIEW");
    case "stale": return asset.stale || asset.readiness === "STALE" || asset.iterations.some((iteration) => iteration.status === "STALE");
    case "rejected": return asset.readiness === "REJECTED" || asset.rejectedIterationIds.length > 0 || asset.iterations.some((iteration) => iteration.status === "REJECTED");
    case "missing": return asset.iterations.length === 0;
    default: return true;
  }
}

/** A picture can bind an image in the director, edit, or authored Bible records. */
function pictureUsesImageIteration(picture: Picture, iteration: GeneratedIteration): boolean {
  const references = new Set([iteration.id, iteration.mediaUri, iteration.previewUri].filter((value): value is string => Boolean(value)));
  const seen = new WeakSet<object>();
  const contains = (value: unknown): boolean => {
    if (typeof value === "string") return references.has(value);
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some(contains);
  };
  return Object.entries(picture).some(([key, value]) =>
    key !== "production" && key !== "importedPackage" && key !== "movieBible" && contains(value),
  ) || contains(picture.movieBible?.records);
}
export function AssetLibraryBrowser({
  picture,
  reviews,
  busy,
  onGenerate,
  onRewrite,
  settingsAction,
}: {
  picture: Picture;
  reviews: AssetReview[];
  busy: boolean;
  onGenerate: (id: string) => void;
  onRewrite: (id: string) => void;
  settingsAction?: ReactNode;
}) {
  const replaceActive = useStudio((s) => s.replaceActive);
  const [category, setCategory] = useWorkspaceDraft("asset-library-category", "all");
  const [selectedId, setSelectedId] = useWorkspaceDraft("asset-library-selection", "");
  const [iterationId, setIterationId] = useWorkspaceDraft("asset-library-iteration", "");
  const [tab, setTab] = useWorkspaceDraft("asset-library-inspector", "preview");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [compareId, setCompareId] = useState("");
  const [enlarged, setEnlarged] = useState(false);
  const [specification, setSpecification] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [undoRemoval, setUndoRemoval] = useState<{
    assetId: string;
    iterationId: string;
    before: NonNullable<Picture["production"]>;
    after: NonNullable<Picture["production"]>;
  } | null>(null);
  const assets = picture.production?.assets.filter((a) => !a.tombstone) ?? [];
  const searchTerms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = assets.filter((item) => {
    if ((category !== "all" && assetReviewGroup(item.category).id !== category) || !matchesAssetStatus(item, status)) return false;
    if (!searchTerms.length) return true;
    const searchable = assetSearchText(item, picture);
    return searchTerms.every((term) => searchable.includes(term));
  });
  const asset = filtered.find((a) => a.id === selectedId) ?? filtered[0];
  const review = reviews.find((r) => r.asset.id === asset?.id);
  const iterations = [...(asset?.iterations ?? [])].reverse();
  const characterChoice = asset?.category === "character" ? picture.editorDrafts?.[`character-media-selection:${asset.id}`] : undefined;
  const savedDisplayId = asset && picture.editorDrafts?.[displayIterationKey(asset.id)];
  const effectiveDisplayId = typeof characterChoice === "string" && characterChoice.startsWith("iteration:")
    ? characterChoice.slice("iteration:".length)
    : characterChoice ? "" : typeof savedDisplayId === "string" ? savedDisplayId : "";
  const displayed = iterations.find((iteration) => iteration.id === effectiveDisplayId && iteration.status !== "REJECTED" && iteration.status !== "STALE" && (iteration.previewUri || iteration.mediaUri));
  const selected = iterationId === NO_ITERATION_SELECTED ? undefined :
    iterations.find((i) => i.id === iterationId) ??
    displayed ??
    iterations.find((i) => i.id === asset?.approvedIterationId) ??
    iterations.find((i) => i.id === review?.latest?.id && i.status !== "REJECTED") ??
    iterations.find((i) => i.status !== "REJECTED") ??
    iterations[0];
  const compared = iterations.find((i) => i.id === compareId && i.id !== selected?.id);
  const source = asset && picture.assetPromptSources?.[asset.id];
  const imageUri = selected?.previewUri ?? selected?.mediaUri;
  const chosenCharacterReference = typeof characterChoice === "string" && characterChoice.startsWith("reference:")
    ? asset?.references.find((reference) => reference.id === characterChoice.slice("reference:".length))
    : undefined;
  const preferredReference = chosenCharacterReference ?? asset?.references.find((reference) => reference.preferred) ?? asset?.references[0];
  const backdropPreview = chosenCharacterReference && !iterationId
    ? chosenCharacterReference.previewUri
    : selected?.previewUri ?? iterations[0]?.previewUri ?? preferredReference?.previewUri;
  const backdropOriginal = chosenCharacterReference && !iterationId
    ? chosenCharacterReference.uri
    : selected?.mediaUri ?? iterations[0]?.mediaUri ?? preferredReference?.uri;
  useEffect(() => {
    if (!enlarged) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEnlarged(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [enlarged]);
  const commitProduction = (production: NonNullable<Picture["production"]>) => {
    const latest = useStudio.getState().pictures.find((p) => p.id === picture.id);
    if (latest) replaceActive({ ...latest, production, updatedAt: Date.now() });
  };
  const confirmDelete = (targetId: string) => {
    const latest = useStudio.getState().pictures.find((item) => item.id === picture.id);
    const target = latest?.production?.assets.find((item) => item.id === asset?.id)?.iterations.find((item) => item.id === targetId);
    if (!latest?.production || !target) {
      setDeleteError("Image iteration is no longer available.");
      return;
    }
    if (targetId === compared?.id) {
      setDeleteError("Stop comparing this image before deleting its iteration.");
      return;
    }
    if (pictureUsesImageIteration(latest, target)) {
      setDeleteError("Another picture record uses this image. Remove that binding before deleting the iteration.");
      return;
    }
    try {
      const before = latest.production;
      const after = deleteUnselectedImageIteration(before, { iterationId: targetId, selectedIterationId: selected?.id ?? null });
      replaceActive({ ...latest, production: after, updatedAt: Date.now() });
      setUndoRemoval({ assetId: asset!.id, iterationId: targetId, before, after });
      setPendingDelete(null);
      setDeleteError(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete this image iteration.");
    }
  };
  const undoDelete = () => {
    const latest = useStudio.getState().pictures.find((item) => item.id === picture.id);
    if (!latest || !undoRemoval || latest.production !== undoRemoval.after) {
      setDeleteError("Another edit changed the asset. Undo is no longer available; the original media file remains intact.");
      setUndoRemoval(null);
      return;
    }
    replaceActive({ ...latest, production: undoRemoval.before, updatedAt: Date.now() });
    setUndoRemoval(null);
    setDeleteError(null);
  };
  /** Saved presentation choice affects only the workbench. Canonical approval remains backend verified. */
  const chooseDisplayIteration = (id: string) => {
    if (!asset || !asset.iterations.some((item) => item.id === id && item.status !== "REJECTED" && item.status !== "STALE" && (item.previewUri || item.mediaUri))) return;
    const latest = useStudio.getState().pictures.find((item) => item.id === picture.id);
    if (!latest) return;
    replaceActive({
      ...latest,
      editorDrafts: {
        ...latest.editorDrafts,
        [displayIterationKey(asset.id)]: id,
        ...(asset.category === "character" ? { [`character-media-selection:${asset.id}`]: `iteration:${id}` } : {}),
      },
    });
  };
  const clearDisplayIteration = () => {
    if (!asset) return;
    const latest = useStudio.getState().pictures.find((item) => item.id === picture.id);
    if (!latest) return;
    const editorDrafts = { ...latest.editorDrafts };
    delete editorDrafts[displayIterationKey(asset.id)];
    if (asset.category === "character" && editorDrafts[`character-media-selection:${asset.id}`] === `iteration:${effectiveDisplayId}`)
      delete editorDrafts[`character-media-selection:${asset.id}`];
    replaceActive({ ...latest, editorDrafts });
  };
  return (
    <section aria-label="Asset library" className={`asset-library-browser${enlarged ? " is-enlarged" : ""}`}>
      <div className="asset-library-backdrop" aria-hidden="true">
        {(backdropPreview || backdropOriginal) && <AssetImagePreview key={`${asset?.id}:${selected?.id}:${chosenCharacterReference?.id ?? ""}`} previewUri={backdropPreview} mediaUri={backdropOriginal} alt="" compact className="asset-library-backdrop-image" />}
      </div>
      {!enlarged && <div className="asset-library-hero-copy" aria-live="polite">
        <span className="asset-library-eyebrow">{asset?.category.replaceAll("_", " ") ?? "Production assets"} · {asset?.id ?? "Library"}</span>
        <h2>{asset?.name ?? "Select an asset"}</h2>
        <span className="asset-library-hero-status">{asset ? asset.approvedIterationId ? "Approved image" : asset.stale ? "Stale source" : asset.iterations.length ? "Imported draft · review pending" : "No generated image" : "Browse the production library"}</span>
      </div>}
      <div className="asset-library-filters flex flex-wrap items-center gap-3">
        <Input
          className="min-w-0 max-w-md flex-1"
          aria-label="Search assets"
          placeholder="Search names, visual traits, references…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="ghost" size="sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
          <SlidersHorizontal size={16} /> Filters
        </Button>
        {settingsAction}
        {filtersOpen && <div className="asset-inline-filters" role="group" aria-label="Asset filters">
            <label className="grid gap-1 text-xs text-muted">
              Category
              <select
                aria-label="Asset category"
                className="min-h-11 rounded border border-border bg-inset px-3 text-fg"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All assets · {assets.length}</option>
                {ASSET_REVIEW_GROUPS.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.label} ·{" "}
                    {assets.filter((a) => assetReviewGroup(a.category).id === group.id).length}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Image status
              <select
                aria-label="Filter asset image status"
                className="min-h-11 rounded border border-border bg-inset px-3 text-fg"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="approved">Approved image</option>
                <option value="pending">Awaiting image approval</option>
                <option value="draft">Draft image</option>
                <option value="stale">Stale source or image</option>
                <option value="rejected">Rejected image</option>
                <option value="missing">No generated images</option>
              </select>
            </label>
        </div>}
        {(category !== "all" || status !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCategory("all");
              setStatus("all");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      <div className="asset-cabinet-carousel">
        <CabinetCarousel
          label="Assets"
          pageSize={10}
          items={filtered.map((item) => {
            const itemReview = reviews.find((r) => r.asset.id === item.id);
            const saved = picture.editorDrafts?.[displayIterationKey(item.id)];
            const characterSaved = item.category === "character" ? picture.editorDrafts?.[`character-media-selection:${item.id}`] : undefined;
            const displayId = typeof characterSaved === "string" && characterSaved.startsWith("iteration:")
              ? characterSaved.slice("iteration:".length)
              : characterSaved ? "" : typeof saved === "string" ? saved : "";
            const characterReference = typeof characterSaved === "string" && characterSaved.startsWith("reference:")
              ? item.references.find((reference) => reference.id === characterSaved.slice("reference:".length))
              : undefined;
            const cover =
              characterReference ? undefined :
              item.iterations.find((i) => i.id === displayId && i.status !== "REJECTED" && i.status !== "STALE") ??
              item.iterations.find((i) => i.id === item.approvedIterationId) ??
              item.iterations.find((i) => i.id === itemReview?.latest?.id && i.status !== "REJECTED") ??
              [...item.iterations].reverse().find((i) => i.status !== "REJECTED");
            const preferred = characterReference ?? item.references.find((r) => r.preferred) ?? item.references[0];
            const uri =
              cover?.previewUri ??
              cover?.mediaUri ??
              preferred?.previewUri ??
              preferred?.uri;
            return (
              <button
                key={item.id}
                title={`${item.name} · ${item.category.replaceAll("_", " ")}`}
                aria-pressed={asset?.id === item.id}
                className="asset-library-tile"
                onClick={() => {
                  setSelectedId(item.id);
                  setIterationId("");
                  setCompareId("");
                  setPendingDelete(null);
                  setDeleteError(null);
                }}
              >
                <span className={`asset-library-thumbnail${uri?.includes("/pictures/prodigal-son/previews/PS-CHR-") ? " is-character-sheet" : ""}`}>
                  {uri ? (
                    <AssetImagePreview
                      previewUri={cover?.previewUri ?? uri}
                      mediaUri={cover?.mediaUri ?? uri}
                      alt={item.name}
                      compact
                    />
                  ) : (
                    <span className="grid place-items-center text-muted">
                      <ImageOff size={20} aria-hidden="true" />
                      <span className="sr-only">No image yet</span>
                    </span>
                  )}
                </span>
                <span className="asset-row-content">
                  <span className="asset-row-name">
                    {item.name}
                  </span>
                  <span className="asset-row-status sr-only">
                    {item.approvedIterationId ? "Approved" : item.stale ? "Stale" : item.iterations.length ? "Needs review" : "No image"}
                  </span>
                </span>
              </button>
            );
          })}
        />
      </div>
      {specification && asset && picture.production ? (
        <AssetInspector
          key={asset.id}
          className="asset-library-specification"
          record={picture.production}
          asset={asset}
          onChange={commitProduction}
          onClose={() => setSpecification(false)}
        />
      ) : <aside className={`asset-library-inspector ${tab === "preview" ? "is-overview" : "is-extended"}`} aria-label="Selected asset inspector">
        <header className="asset-inspector-heading"><div><span className="asset-inspector-kicker">Asset details</span><h2 title={asset?.name}>{asset?.name ?? "Choose an asset"}</h2></div><span className="asset-inspector-state">{asset?.approvedIterationId ? "Approved" : asset?.iterations.length ? "Needs review" : "No image"}</span></header>
        <div className="asset-detail-modal" aria-label="Selected asset inspector">
          {asset ? (
            <>
              <div>
                <div className="workspace-tabs asset-inspector-tabs" aria-label="Asset inspector views">
                  {[
                    ["preview", "Details"],
                    ["prompt", "Prompt"],
                    ["references", "References"],
                    ["review", "Review"],
                    ["versions", "Versions"],
                  ].map(([id, label]) => (
                    <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                {tab === "preview" && (
                  <div className="asset-inspector-body">
                    <dl className="asset-spec-list">
                      {([
                        ["Identity", asset.canonicalSpec.identity],
                        ["Appearance", asset.canonicalSpec.appearance],
                        ["Direction", asset.canonicalSpec.visualDescription],
                        ["Period", asset.canonicalSpec.period],
                        ["Scenes", `${asset.requiredSceneIds.length} linked`],
                      ] as const).filter(([, value]) => Boolean(value)).map(([label, value]) => (
                        <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>
                      ))}
                    </dl>
                    <div className="asset-inspector-actions">
                      <Button size="sm" variant="secondary" onClick={() => setSpecification(true)}>Full specification</Button>
                      <Button size="sm" variant="ghost" disabled={!backdropPreview && !backdropOriginal} onClick={() => setEnlarged(true)}><Maximize2 /> View image</Button>
                    </div>
                    <details className="asset-overview-more">
                      <summary>Image choices and linked records</summary>
                      <div className="asset-inspector-actions">
                        {selected && imageUri && selected.status !== "REJECTED" && selected.status !== "STALE" && displayed?.id !== selected.id &&
                          <Button size="sm" variant="secondary" onClick={() => chooseDisplayIteration(selected.id)}>Show in workspace</Button>}
                        {effectiveDisplayId && <Button size="sm" variant="ghost" onClick={clearDisplayIteration}>{displayed ? "Clear display choice" : "Clear unavailable display choice"}</Button>}
                        {selected && picture.production && imageIterationDeletionEligibility(picture.production, selected.id, null).allowed &&
                          <Button size="sm" variant="ghost" onClick={() => { setIterationId(NO_ITERATION_SELECTED); setCompareId(""); setPendingDelete(null); }}>Deselect draft image</Button>}
                      </div>
                      {selected && <p className="asset-inspector-caption">{displayed?.id === selected.id ? "Shown in workspace" : "Selected iteration"} · {selected.status.toLowerCase().replaceAll("_", " ")}{selected.width && selected.height ? ` · ${selected.width} × ${selected.height}` : ""} · {new Date(selected.createdAt).toLocaleDateString()}</p>}
                      {compared && <figure className="asset-comparison"><AssetImagePreview previewUri={compared.previewUri} mediaUri={compared.mediaUri} alt={`${asset.name}, comparison iteration`} onRepair={() => setTab("references")} /><figcaption>Comparison · {compared.status.toLowerCase().replaceAll("_", " ")}</figcaption></figure>}
                      <label className="grid gap-2 text-xs text-muted">Compare with
                        <select aria-label="Compare image iterations" className="min-h-10 rounded border border-border bg-inset px-2 text-fg" value={compared?.id ?? ""} onChange={(e) => setCompareId(e.target.value)}>
                          <option value="">No comparison</option>
                          {iterations.filter((i) => i.id !== selected?.id && i.mediaUri).map((i) => <option key={i.id} value={i.id}>{new Date(i.createdAt).toLocaleString()} · {i.status}</option>)}
                        </select>
                      </label>
                    {(asset.category === "character" || asset.category === "location" || asset.category === "prop" || asset.category === "wardrobe") && (
                      <Button
                        variant="secondary"
                        onClick={() => asset.category === "character"
                          ? openCharacterSheet(picture.id, asset.id)
                          : (asset.category === "location" || asset.category === "prop" || asset.category === "wardrobe") && openWorldSheet(picture.id, asset.id, asset.category)}
                      >
                        Open {asset.category} sheet
                      </Button>
                    )}
                    {asset.category === "character" && (
                      <CharacterVoiceSamples pictureId={picture.id} characterId={asset.id} />
                    )}
                    {["voice", "music", "sound"].includes(asset.category) && (
                      <Button
                        variant="secondary"
                        onClick={() => useStudio.getState().openAdvancedDepartment("score")}
                      >
                        Open sound & voice workspace
                      </Button>
                    )}
                    </details>
                  </div>
                )}
                {tab === "prompt" && (
                  <div className="grid gap-3">
                    <p className="text-xs text-muted">
                      {review?.sourceCurrent
                        ? "Prompt matches the current screenplay and camera direction."
                        : "Prompt needs writing or updating before generation."}
                    </p>
                    <Textarea
                      aria-label={`${asset.name} image prompt`}
                      className="min-h-80"
                      disabled={busy}
                      value={review?.prompt ?? ""}
                      onChange={(e) => {
                        const latest = useStudio
                          .getState()
                          .pictures.find((p) => p.id === picture.id);
                        if (latest)
                          replaceActive({
                            ...latest,
                            assetImagePrompts: {
                              ...latest.assetImagePrompts,
                              [asset.id]: e.target.value,
                            },
                            updatedAt: Date.now(),
                          });
                      }}
                    />
                    {source && (
                      <details>
                        <summary className="cursor-pointer text-sm">
                          Source & prompt provenance
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
                          {source.sourceQuote}
                        </p>
                        <p className="mt-2 break-words text-xs text-muted">
                          {source.sceneIds.join(" · ")} · {source.modelId}
                        </p>
                      </details>
                    )}
                  </div>
                )}
                {tab === "references" && (
                  <div className="grid gap-4">
                    {picture.production && (
                      <AssetReferenceUpload
                        record={picture.production}
                        assetId={asset.id}
                        onChange={commitProduction}
                        disabled={busy}
                      />
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {asset.references.map((ref) => (
                        <figure key={ref.id}>
                          <img
                            src={ref.previewUri ?? ref.uri}
                            alt={ref.name}
                            className="aspect-square w-full rounded bg-inset object-contain"
                          />
                          <figcaption className="mt-1 break-words text-xs text-muted">
                            {ref.name}
                            {ref.preferred ? " · Preferred" : ""}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                    {!asset.references.length && (
                      <p className="text-sm text-muted">No design references attached.</p>
                    )}
                  </div>
                )}
                {tab === "review" &&
                  (selected ? (
                    <ImageIterationReview
                      key={selected.id}
                      picture={picture}
                      iterationId={selected.id}
                    />
                  ) : (
                    <p className="text-sm text-muted">Choose a generated iteration to review.</p>
                  ))}
                {tab === "versions" && <section
                  className="asset-versions"
                  aria-label="Image iteration history"
                >
                  <h4 className="text-sm">All iterations · {iterations.length}</h4>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {iterations.map((i, index) => {
                      const eligibility = picture.production && imageIterationDeletionEligibility(picture.production, i.id, selected?.id ?? null);
                      const canDelete = eligibility?.allowed && i.id !== compared?.id && !pictureUsesImageIteration(picture, i);
                      return <div key={i.id} className="min-w-0">
                        <button
                          aria-label={`Preview iteration ${iterations.length - index} of ${asset.name}`}
                          aria-pressed={selected?.id === i.id}
                          className={`w-full overflow-hidden rounded border p-1 text-left ${selected?.id === i.id ? "border-accent" : "border-border"}`}
                          onClick={() => {
                            setIterationId(i.id);
                            setCompareId("");
                            setPendingDelete(null);
                            setDeleteError(null);
                          }}
                        >
                          <AssetImagePreview
                            previewUri={i.previewUri}
                            mediaUri={i.mediaUri}
                            alt={`Iteration ${iterations.length - index}`}
                            className="aspect-square w-full bg-inset object-contain"
                          />
                          <span className="block p-1 text-[10px] text-muted">
                            {displayed?.id === i.id ? "Shown in workspace · " : ""}
                            {asset.approvedIterationId === i.id
                              ? "Canonical approved"
                              : i.status === "APPROVED" ? "Previous approval" : i.status.toLowerCase().replaceAll("_", " ")}{" "}
                            · {iterations.length - index}
                          </span>
                        </button>
                        {canDelete && <Button
                          variant="ghost"
                          size="sm"
                          className="mt-1 w-full text-xs"
                          disabled={busy}
                          onClick={() => { setPendingDelete(i.id); setDeleteError(null); }}
                        >Delete iteration {iterations.length - index}</Button>}
                      </div>;
                    })}
                  </div>
                  {!!iterations.length && <p className="mt-2 text-[11px] text-muted">Deletion is available for unselected draft imports. Canonical, reviewed and native images stay protected.</p>}
                  {pendingDelete && iterations.some((item) => item.id === pendingDelete) && <div className="mt-3 grid gap-2 border-t border-border pt-3" role="group" aria-label="Confirm image iteration deletion">
                    <p className="text-xs text-muted">Delete this unselected draft image from the asset library? The original media file stays in place, and Undo is available until another edit.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={busy} onClick={() => confirmDelete(pendingDelete)}>Delete draft iteration</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setPendingDelete(null); setDeleteError(null); }}>Cancel</Button>
                    </div>
                  </div>}
                  {deleteError && <p className="mt-2 text-xs text-destructive" role="alert">{deleteError}</p>}
                  {undoRemoval?.assetId === asset.id && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted" role="status">
                    <span>Iteration {undoRemoval.iterationId} removed from this asset. Original media retained.</span>
                    <Button size="sm" variant="ghost" onClick={undoDelete}>Undo deletion</Button>
                  </div>}
                  {!iterations.length && (
                    <p className="mt-2 break-words text-xs text-muted">
                      No generated or imported images yet.
                    </p>
                  )}
                </section>}
                {review && (tab === "prompt" || tab === "review") && (
                  <footer className="asset-generate-actions">
                    <Button
                      disabled={busy || !review.sourceCurrent}
                      onClick={() => onGenerate(asset.id)}
                    >
                      {selected ? "Generate new iteration" : "Generate image"}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => onRewrite(asset.id)}>
                      Rewrite prompt & generate
                    </Button>
                  </footer>
                )}
              </div>
            </>
          ) : (
            <p className="p-6 text-sm text-muted">
              Select an asset to inspect its images, prompts and references.
            </p>
          )}
        </div>
      </aside>}
      {enlarged && (backdropPreview || backdropOriginal) && <section className="asset-enlarged-panel" aria-label="Full selected asset image">
        <header><h2>{asset?.name} · full image</h2><Button variant="secondary" onClick={() => setEnlarged(false)}>Return to assets</Button></header>
        <AssetImagePreview previewUri={backdropPreview} mediaUri={backdropOriginal} alt={`${asset?.name ?? "Asset"}, full source image`} onRepair={() => { setEnlarged(false); setTab("references"); }} />
      </section>}
    </section>
  );
}
