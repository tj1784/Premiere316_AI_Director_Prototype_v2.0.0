import { CabinetCarousel } from "./cabinet";
import { openCharacterSheet } from "./workspace-links";
import type { CSSProperties } from "react";
import { AssetImagePreview } from "./asset-image-preview";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Image, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import type { ProductionAsset, GeneratedIteration } from "@/lib/production";
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
export function AssetLibraryBrowser({
  picture,
  reviews,
  busy,
  onGenerate,
  onRewrite,
}: {
  picture: Picture;
  reviews: AssetReview[];
  busy: boolean;
  onGenerate: (id: string) => void;
  onRewrite: (id: string) => void;
}) {
  const replaceActive = useStudio((s) => s.replaceActive);
  const [category, setCategory] = useWorkspaceDraft("asset-library-category", "all");
  const [selectedId, setSelectedId] = useWorkspaceDraft("asset-library-selection", "");
  const [iterationId, setIterationId] = useWorkspaceDraft("asset-library-iteration", "");
  const [tab, setTab] = useWorkspaceDraft("asset-library-inspector", "preview");
  const [query, setQuery] = useState("");
  const [inspectorWidth, setInspectorWidth] = useWorkspaceDraft("asset-inspector-width", 384);
  const [status, setStatus] = useState("all");
  const [compareId, setCompareId] = useState("");
  const [enlarged, setEnlarged] = useState(false);
  const [specification, setSpecification] = useState(false);
  const assets = picture.production?.assets.filter((a) => !a.tombstone) ?? [];
  const filtered = assets.filter(
    (a) =>
      (category === "all" || assetReviewGroup(a.category).id === category) &&
      `${a.name} ${a.aliases.join(" ")} ${a.canonicalSpec.visualDescription}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (status === "all" ||
        (status === "approved" ? Boolean(a.approvedIterationId) : !a.approvedIterationId)),
  );
  const asset = filtered.find((a) => a.id === selectedId) ?? filtered[0];
  const review = reviews.find((r) => r.asset.id === asset?.id);
  const iterations = [...(asset?.iterations ?? [])].reverse();
  const selected =
    iterations.find((i) => i.id === iterationId) ??
    iterations.find((i) => i.id === asset?.approvedIterationId) ??
    review?.latest ??
    iterations[0];
  const compared = iterations.find((i) => i.id === compareId && i.id !== selected?.id);
  const source = asset && picture.assetPromptSources?.[asset.id];
  const imageUri = selected?.previewUri ?? selected?.mediaUri;
  const commitProduction = (production: NonNullable<Picture["production"]>) => {
    const latest = useStudio.getState().pictures.find((p) => p.id === picture.id);
    if (latest) replaceActive({ ...latest, production, updatedAt: Date.now() });
  };
  return (
    <section aria-label="Asset library" className="grid gap-4">
      <div className="workspace-tabs" aria-label="Asset categories">
        <button aria-pressed={category === "all"} onClick={() => setCategory("all")}>
          All assets · {assets.length}
        </button>
        {ASSET_REVIEW_GROUPS.map((group) => (
          <button
            key={group.id}
            aria-pressed={category === group.id}
            onClick={() => setCategory(group.id)}
          >
            {group.label} ·{" "}
            {assets.filter((a) => assetReviewGroup(a.category).id === group.id).length}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-md"
          aria-label="Search assets"
          placeholder="Search assets or visual descriptions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Filter asset approval"
          className="min-h-10 rounded border border-border bg-inset px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="approved">Approved image</option>
          <option value="pending">Awaiting image approval</option>
        </select>
        <span className="text-xs text-muted" role="status">
          {filtered.length} assets
        </span>
      </div>
      <div
        className="asset-library-layout"
        style={
          {
            "--asset-inspector-width": `${Math.max(280, Math.min(480, inspectorWidth))}px`,
          } as CSSProperties
        }
      >
        <div className="asset-cabinet-carousel">
          <CabinetCarousel label="Assets" pageSize={4} items={filtered.map((item) => {
            const itemReview = reviews.find((r) => r.asset.id === item.id);
            const cover =
              item.iterations.find((i) => i.id === item.approvedIterationId) ?? itemReview?.latest;
            const uri =
              cover?.previewUri ??
              cover?.mediaUri ??
              item.references.find((r) => r.preferred)?.previewUri ??
              item.references.find((r) => r.preferred)?.uri;
            return (
              <button
                key={item.id}
                aria-pressed={asset?.id === item.id}
                className="asset-library-tile"
                onClick={() => {
                  setSelectedId(item.id);
                  setIterationId("");
                  setCompareId("");
                }}
              >
                <span className="asset-library-thumbnail">
                  {uri ? (
                    <AssetImagePreview
                      previewUri={cover?.previewUri ?? uri}
                      mediaUri={cover?.mediaUri ?? uri}
                      alt={item.name}
                    />
                  ) : (
                    <span className="grid place-items-center gap-2 text-muted">
                      <Image aria-hidden="true" />
                      <span className="text-xs">No image yet</span>
                    </span>
                  )}
                </span>
                <span className="block p-3">
                  <span className="block truncate font-display text-lg">{item.name}</span>
                  <span className="mt-1 block text-xs text-muted">
                    {item.category.replaceAll("_", " ")} · {item.iterations.length} iterations
                  </span>
                  <span className="mt-2 block text-xs text-accent">
                    {item.approvedIterationId ? "Approved image" : "Awaiting approval"}
                  </span>
                </span>
              </button>
            );
          })}/>
          {!filtered.length && (
            <p className="col-span-full rounded-lg border border-dashed border-border p-8 text-sm text-muted">
              No assets match this view. Change the filters, or prepare the screenplay breakdown in
              Specification & preparation.
            </p>
          )}
        </div>
        <aside className="asset-library-inspector" aria-label="Selected asset inspector">
          {asset ? (
            <>
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
                <div>
                  <p className="workspace-eyebrow">{asset.category.replaceAll("_", " ")}</p>
                  <h3 className="mt-1 font-display text-2xl">{asset.name}</h3>
                </div>
                <Badge>{asset.approvedIterationId ? "Approved image" : "In development"}</Badge>
              </header>
              <div className="p-4">
                <label className="mb-4 hidden items-center gap-3 text-xs text-muted xl:flex">
                  Inspector width
                  <input
                    aria-label="Asset inspector width"
                    className="min-w-0 flex-1 accent-accent"
                    type="range"
                    min={280}
                    max={480}
                    step={8}
                    value={inspectorWidth}
                    onChange={(e) => setInspectorWidth(Number(e.target.value))}
                  />
                </label>
                <div className="workspace-tabs mb-4" aria-label="Asset inspector views">
                  {[
                    ["preview", "Preview"],
                    ["prompt", "Prompt"],
                    ["references", "References"],
                    ["review", "Review"],
                  ].map(([id, label]) => (
                    <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                {tab === "preview" && (
                  <div className="grid gap-4">
                    <div className={compared ? "grid grid-cols-2 gap-2" : ""}>
                      <figure>
                        <div className="asset-preview">
                          {imageUri ? (
                            <AssetImagePreview
                              previewUri={selected?.previewUri}
                              mediaUri={selected?.mediaUri}
                              alt={`${asset.name}, selected iteration`}
                              onRepair={() => setTab("references")}
                            />
                          ) : (
                            <p className="p-8 text-center text-sm text-muted">
                              Generate or import an image to preview it here.
                            </p>
                          )}
                        </div>
                        <figcaption className="mt-2 text-xs text-muted">
                          {selected
                            ? `Selected preview · ${selected.status.toLowerCase().replaceAll("_", " ")}`
                            : "No image selected"}
                        </figcaption>
                      </figure>
                      {compared && (
                        <figure>
                          <div className="asset-preview">
                            <AssetImagePreview
                              previewUri={compared.previewUri}
                              mediaUri={compared.mediaUri}
                              alt={`${asset.name}, comparison iteration`}
                              onRepair={() => setTab("references")}
                            />
                          </div>
                          <figcaption className="mt-2 text-xs text-muted">
                            Comparison · {compared.status.toLowerCase().replaceAll("_", " ")}
                          </figcaption>
                        </figure>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!imageUri}
                        onClick={() => setEnlarged(true)}
                      >
                        <Maximize2 />
                        Enlarge
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setSpecification(true)}>
                        Edit specification
                      </Button>
                    </div>
                    {selected && (
                      <p className="text-xs text-muted">
                        {selected.width && selected.height
                          ? `${selected.width} × ${selected.height} · `
                          : ""}
                        {new Date(selected.createdAt).toLocaleString()}
                        {selected.execution ? ` · ${selected.execution.engineName}` : ""}
                      </p>
                    )}
                    <label className="grid gap-2 text-xs text-muted">
                      Compare with
                      <select
                        aria-label="Compare image iterations"
                        className="min-h-10 rounded border border-border bg-inset px-2 text-fg"
                        value={compared?.id ?? ""}
                        onChange={(e) => setCompareId(e.target.value)}
                      >
                        <option value="">No comparison</option>
                        {iterations
                          .filter((i) => i.id !== selected?.id && i.mediaUri)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {new Date(i.createdAt).toLocaleString()} · {i.status}
                            </option>
                          ))}
                      </select>
                    </label>
                    {["character", "location", "prop", "wardrobe"].includes(asset.category) && (
                      <Button
                        variant="secondary"
                        onClick={() => openCharacterSheet(picture.id, asset.id)}
                      >
                        Open {asset.category} sheet
                      </Button>
                    )}
                    <p className="text-sm leading-relaxed text-muted">
                      {asset.canonicalSpec.visualDescription ||
                        "No visual description authored yet."}
                    </p>
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
                        <p className="mt-2 text-xs text-muted">
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
                          <figcaption className="mt-1 text-xs text-muted">
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
                <section
                  className="mt-5 border-t border-border pt-4"
                  aria-label="Image iteration history"
                >
                  <h4 className="text-sm">All iterations · {iterations.length}</h4>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {iterations.map((i, index) => (
                      <button
                        key={i.id}
                        aria-label={`Preview iteration ${iterations.length - index} of ${asset.name}`}
                        aria-pressed={selected?.id === i.id}
                        className={`overflow-hidden rounded border p-1 text-left ${selected?.id === i.id ? "border-accent" : "border-border"}`}
                        onClick={() => {
                          setIterationId(i.id);
                          setCompareId("");
                        }}
                      >
                        <AssetImagePreview
                          previewUri={i.previewUri}
                          mediaUri={i.mediaUri}
                          alt={`Iteration ${iterations.length - index}`}
                          className="aspect-square w-full bg-inset object-contain"
                        />
                        <span className="block p-1 text-[10px] text-muted">
                          {asset.approvedIterationId === i.id
                            ? "Approved"
                            : i.status.toLowerCase().replaceAll("_", " ")}{" "}
                          · {iterations.length - index}
                        </span>
                      </button>
                    ))}
                  </div>
                  {!iterations.length && (
                    <p className="mt-2 text-xs text-muted">No generated or imported images yet.</p>
                  )}
                </section>
                {review && (
                  <footer className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
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
        </aside>
      </div>
      {specification && asset && picture.production && (
        <AssetInspector
          key={asset.id}
          record={picture.production}
          asset={asset}
          onChange={commitProduction}
          onClose={() => setSpecification(false)}
        />
      )}
      <Dialog.Root open={enlarged && Boolean(imageUri)} onOpenChange={setEnlarged}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/90" />
          <Dialog.Content className="fixed inset-4 z-50 flex flex-col overflow-auto rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title className="font-display text-xl">{asset?.name}</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="secondary">Close preview</Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-2 text-sm text-muted">
              Selected image iteration
            </Dialog.Description>
            <img
              src={imageUri}
              alt={asset?.name ?? "Asset preview"}
              className="min-h-0 flex-1 object-contain"
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
