import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, GitMerge, GitPullRequestArrow, Plus, Split, Star, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import {
  PRODUCTION_CATEGORIES,
  addAssetVariant,
  approveInventoryAssetSpec,
  editInventoryAsset,
  markRequirementUnnecessary,
  mergeInventoryAssets,
  removeAssetVariant,
  setPreferredReference,
  replaceAssetImage,
  splitInventoryAsset,
  type ProductionAsset,
  type ProductionBreakdown,
  type ProductionCategory,
} from "@/lib/production";
import { uid } from "@/lib/utils";
import { PRODUCTION_CATEGORY_LABELS } from "./inventory-constants";
import { ReadinessBadge } from "./inventory-primitives";
import { AssetReferenceUpload } from "./asset-reference-upload";
import { CharacterVoiceSamples } from "../studio/character-voice-samples";

export function AssetInspector({ record, asset, onChange, onClose }: { record: ProductionBreakdown; asset: ProductionAsset; onChange: (record: ProductionBreakdown) => void; onClose: () => void }) {
  type InspectorTab = "identity" | "scenes" | "images" | "breakdown" | "readiness";
  const [activeTab, setActiveTab] = useState<InspectorTab>("identity");
  const tabId = useId();
  const [name, setName] = useState(asset.name);
  const [extraScenes, setExtraScenes] = useState<string[]>([]);
  const [category, setCategory] = useState(asset.category);
  const [description, setDescription] = useState(asset.canonicalSpec.visualDescription);
  const [identity, setIdentity] = useState(asset.canonicalSpec.identity);
  const [locks, setLocks] = useState(asset.canonicalSpec.continuityLocks.join(", "));
  const [negative, setNegative] = useState(asset.canonicalSpec.negativeRequirements.join(", "));
  const [prohibited, setProhibited] = useState(asset.canonicalSpec.prohibitedFeatures.join(", "));
  const [variantName, setVariantName] = useState("");
  const [mergeId, setMergeId] = useState("");
  const [splitRequirementId, setSplitRequirementId] = useState("");
  const [splitName, setSplitName] = useState("");
  const inspectorRef = useRef<HTMLElement | null>(null);
  const currentRecordRef = useRef(record);

  useEffect(() => { currentRecordRef.current = record; }, [record]);
  const applyRecord = (next: ProductionBreakdown) => {
    currentRecordRef.current = next;
    onChange(next);
  };

  useEffect(() => {
    setName(asset.name);
    setCategory(asset.category);
    setDescription(asset.canonicalSpec.visualDescription);
    setIdentity(asset.canonicalSpec.identity);
    setLocks(asset.canonicalSpec.continuityLocks.join(", "));
    setNegative(asset.canonicalSpec.negativeRequirements.join(", "));
    setProhibited(asset.canonicalSpec.prohibitedFeatures.join(", "));
  }, [
    asset.id,
    asset.updatedAt,
    asset.name,
    asset.category,
    asset.canonicalSpec.identity,
    asset.canonicalSpec.visualDescription,
    asset.canonicalSpec.continuityLocks,
    asset.canonicalSpec.negativeRequirements,
    asset.canonicalSpec.prohibitedFeatures,
  ]);

  useEffect(() => {
    setActiveTab("identity");
    setExtraScenes([]);
    inspectorRef.current?.querySelector<HTMLElement>("[data-inspector-heading]")?.focus();
  }, [asset.id]);

  const mergeOptions = useMemo(() => record.assets.filter((item) => item.id !== asset.id && item.category === asset.category), [record.assets, asset.id, asset.category]);
  const requirements = record.requirements.filter((item) => asset.requirementIds.includes(item.id) && !item.unnecessary);
  const sceneLabels = asset.requiredSceneIds.map((id) => record.scenes.find((scene) => scene.id === id)?.slugline ?? id);

  const specPatch = () => ({
    identity,
    visualDescription: description,
    continuityLocks: commaList(locks),
    negativeRequirements: commaList(negative),
    prohibitedFeatures: commaList(prohibited),
  });

  const save = () => {
    applyRecord(editInventoryAsset(currentRecordRef.current, asset.id, {
      name,
      category,
      additionalSceneIds: extraScenes,
      canonicalSpec: specPatch(),
    }));
  };

  return (
    <aside
      ref={inspectorRef}
      aria-labelledby={`${tabId}-heading`}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border/65 bg-surface/75 text-fg"
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/65 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] text-subtle">Asset details</p>
          <h2 id={`${tabId}-heading`} data-inspector-heading tabIndex={-1} className="mt-1 truncate font-display text-xl tracking-tight outline-none" title={asset.name}>{asset.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2"><ReadinessBadge readiness={asset.readiness} />{asset.hero ? <Badge>Hero asset</Badge> : null}{asset.stale ? <Badge className="text-rec">Stale</Badge> : null}</div>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close asset details" onClick={onClose}><X /></Button>
      </header>
      <div role="tablist" aria-label="Asset details" className="flex shrink-0 gap-0 overflow-x-auto border-b border-border/65 px-2">
        {([
          ["identity", "Identity"], ["scenes", "Scenes & states"], ["images", "References"],
          ["breakdown", "Breakdown"], ["readiness", "Readiness"],
        ] as const).map(([id, title]) => (
          <button
            type="button"
            role="tab"
            key={id}
            id={`${tabId}-${id}-tab`}
            aria-selected={activeTab === id}
            aria-controls={activeTab === id ? `${tabId}-${id}-panel` : undefined}
            className={`shrink-0 border-b-2 px-3 py-3 text-xs transition-colors ${activeTab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
            onClick={() => setActiveTab(id)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const tabs = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
              const index = tabs.indexOf(event.currentTarget);
              const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              tabs[next]?.focus();
              tabs[next]?.click();
            }}
          >{title}</button>
        ))}
      </div>
      <div id={`${tabId}-${activeTab}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${activeTab}-tab`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 outline-none">
        {activeTab === "identity" ? <>
          <section>
            <SectionHeading title="Canonical specification" detail="Engine-independent source of truth" />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Asset name" value={name} onChange={setName} />
              <div><Label htmlFor="asset-category">Category</Label><select id="asset-category" className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)] outline-none" value={category} onChange={(event) => setCategory(event.target.value as ProductionCategory)}>{PRODUCTION_CATEGORIES.map((item) => <option key={item} value={item}>{PRODUCTION_CATEGORY_LABELS[item]}</option>)}</select></div>
              <div className="sm:col-span-2"><Field label="Stable identity" value={identity} onChange={setIdentity} /></div>
              <div className="sm:col-span-2"><Label htmlFor="asset-description">Visual / production description</Label><Textarea id="asset-description" className="mt-1.5 min-h-28" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
              <div className="sm:col-span-2"><Field label="Continuity locks · comma separated" value={locks} onChange={setLocks} /></div>
              <div className="sm:col-span-2"><Field label="Negative requirements · comma separated" value={negative} onChange={setNegative} /></div>
              <div className="sm:col-span-2"><Field label="Prohibited features · comma separated" value={prohibited} onChange={setProhibited} /></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={save}>Save changes</Button><Button disabled={!description.trim()} onClick={() => applyRecord(approveInventoryAssetSpec(editInventoryAsset(currentRecordRef.current, asset.id, { name, category, canonicalSpec: specPatch() }), asset.id))}><Check /> Approve specification</Button></div>
          </section>

          {asset.category === "character" ? <div className="mt-6 border-t border-border/60 pt-5"><CharacterVoiceSamples pictureId={record.pictureId} characterId={asset.id} expanded /></div> : null}
        </> : null}

        {activeTab === "scenes" ? <>
          <section>
            <SectionHeading title="Required scenes" detail={`${sceneLabels.length} screenplay links`} />
            <fieldset className="mt-2 grid gap-2"><legend className="text-xs text-muted">Add missing scene links, then Save changes</legend>{record.scenes.map(scene => <label key={scene.id} className="flex items-start gap-2 text-xs"><input type="checkbox" aria-label={`Link ${scene.id}`} checked={asset.requiredSceneIds.includes(scene.id) || extraScenes.includes(scene.id)} disabled={asset.requiredSceneIds.includes(scene.id)} onChange={e => setExtraScenes(current => e.target.checked ? [...current, scene.id] : current.filter(id => id !== scene.id))} />{scene.slugline}</label>)}</fieldset>
            <ul className="mt-2 grid gap-1">{sceneLabels.map((label) => <li key={label} className="break-words border-b border-border/60 py-2 text-xs text-muted">{label}</li>)}</ul>
            {extraScenes.length ? <Button className="mt-3" variant="secondary" onClick={save}>Save scene links</Button> : null}
          </section>
          <Divider />
          <section>
            <SectionHeading title="Variants" detail={`${asset.variants.length} continuity states`} />
            <ul className="mt-2 grid gap-2">{asset.variants.map((variant) => <li key={variant.id} className="flex min-w-0 items-center justify-between gap-2 border-b border-border/60 py-2"><div className="min-w-0"><p className="truncate text-xs">{variant.name}</p><p className="text-[10px] text-subtle">{variant.requiredSceneIds.length} scenes{variant.stale ? " · stale" : ""}</p></div><Button size="icon-sm" variant="ghost" aria-label={`Remove ${variant.name}`} onClick={() => applyRecord(removeAssetVariant(currentRecordRef.current, asset.id, variant.id))}><Trash2 /></Button></li>)}</ul>
            <div className="mt-2 flex gap-2"><Input value={variantName} onChange={(event) => setVariantName(event.target.value)} placeholder="New variant name" /><Button size="icon" variant="secondary" aria-label="Add variant" disabled={!variantName.trim()} onClick={() => { applyRecord(addAssetVariant(currentRecordRef.current, asset.id, { id: uid("variant"), name: variantName.trim(), requiredSceneIds: asset.requiredSceneIds, requirementIds: asset.requirementIds, specPatch: { continuityLocks: [variantName.trim()] }, stale: false, staleReasons: [] })); setVariantName(""); }}><Plus /></Button></div>
          </section>
        </> : null}

        {activeTab === "images" ? <>
          <section>
            <SectionHeading title="References" detail={asset.referenceRequired ? "At least one reference required" : "Optional"} />
            <AssetReferenceUpload record={record} assetId={asset.id} onChange={applyRecord} />
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
              {asset.references.map((reference) => <div key={reference.id} className="min-w-0 border-b border-border/60 pb-3"><img src={reference.previewUri ?? reference.uri} alt="" className="aspect-square w-full rounded-sm object-cover" /><p className="mt-1 truncate text-[10px] text-muted" title={reference.name}>{reference.name}</p><button type="button" className="mt-1 inline-flex h-9 w-full items-center justify-center gap-1 rounded-sm text-[10px] text-muted hover:text-fg" onClick={() => applyRecord(setPreferredReference(currentRecordRef.current, asset.id, reference.id))}><Star className="size-3" /> {reference.preferred ? "Preferred" : "Prefer"}</button><Button className="mt-2 w-full" onClick={() => applyRecord(replaceAssetImage(currentRecordRef.current, asset.id, { uri: reference.uri, name: reference.name }))}>Use as asset image</Button></div>)}
            </div>
          </section>
        </> : null}

        {activeTab === "breakdown" ? <>
          <section>
            <SectionHeading title="Breakdown requirements" detail="User-correctable extraction evidence" />
            <ul className="mt-2 grid gap-2">{requirements.map((requirement) => <li key={requirement.id} className="border-b border-border/60 py-2"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-xs">{requirement.name}</p><p className="mt-1 break-words text-[10px] leading-relaxed text-subtle">{requirement.description}</p></div>{requirement.confidence ? <Badge>{requirement.confidence}</Badge> : null}</div><button type="button" className="mt-2 h-9 text-[10px] text-muted hover:text-fg" onClick={() => applyRecord(markRequirementUnnecessary(currentRecordRef.current, requirement.id))}>Mark unnecessary</button></li>)}</ul>
          </section>

          {mergeOptions.length || requirements.length > 1 ? <Divider /> : null}
          {mergeOptions.length ? <section><SectionHeading title="Merge duplicate" detail="Combine another asset into this identity" /><div className="mt-2 flex gap-2"><select className="h-11 min-w-0 flex-1 rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]" value={mergeId} onChange={(event) => setMergeId(event.target.value)}><option value="">Choose duplicate</option>{mergeOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button variant="secondary" disabled={!mergeId} onClick={() => { applyRecord(mergeInventoryAssets(currentRecordRef.current, asset.id, [mergeId])); setMergeId(""); }}><GitMerge /> Merge</Button></div></section> : null}
          {requirements.length > 1 ? <section className="mt-5"><SectionHeading title="Split asset" detail="Move one requirement into a separate asset" /><div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><select className="h-11 min-w-0 rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]" value={splitRequirementId} onChange={(event) => setSplitRequirementId(event.target.value)}><option value="">Choose requirement</option>{requirements.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Input value={splitName} onChange={(event) => setSplitName(event.target.value)} placeholder="New asset name" /><Button variant="secondary" disabled={!splitRequirementId || !splitName.trim()} onClick={() => { applyRecord(splitInventoryAsset(currentRecordRef.current, asset.id, { newAssetId: uid("asset"), name: splitName.trim(), requirementIds: [splitRequirementId] })); setSplitName(""); setSplitRequirementId(""); }}><Split /> Split</Button></div></section> : null}

        </> : null}

        {activeTab === "readiness" ? <section><SectionHeading title="Preparation status" detail="Saved, queued, and waiting for explicit generation" /><div className="mt-4 border-t border-border/60 pt-4 text-xs text-muted"><div className="flex items-center gap-2"><GitPullRequestArrow className="size-4 text-accent" /><ReadinessBadge readiness={asset.readiness} /></div><p className="mt-3 leading-relaxed">{asset.referenceRequired && !asset.references.length ? "Waiting for a required reference." : asset.canonicalApproved ? "Canonical specification is approved for preparation." : "Approve the canonical specification before generation can be ready."}</p></div></section> : null}
      </div>
    </aside>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = `field-${label.toLocaleLowerCase().replace(/[^a-z]+/g, "-")}`;
  return <div><Label htmlFor={id}>{label}</Label><Input id={id} className="mt-1.5" value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return <div><h3 className="text-sm">{title}</h3><p className="mt-0.5 text-[10px] text-subtle">{detail}</p></div>;
}

function Divider() { return <div className="my-5 border-t border-border" />; }
function commaList(value: string) { return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]; }
