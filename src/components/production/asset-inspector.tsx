import { useEffect, useMemo, useState } from "react";
import { Check, GitMerge, GitPullRequestArrow, ImagePlus, Plus, Split, Star, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import {
  PRODUCTION_CATEGORIES,
  addAssetVariant,
  approveCanonicalSpec,
  attachReference,
  editAsset,
  markRequirementUnnecessary,
  mergeAssets,
  removeAssetVariant,
  setPreferredReference,
  splitAsset,
  type ProductionAsset,
  type ProductionBreakdown,
  type ProductionCategory,
} from "@/lib/production";
import { uid } from "@/lib/utils";
import { PRODUCTION_CATEGORY_LABELS } from "./inventory-constants";
import { ReadinessBadge } from "./inventory-primitives";

export function AssetInspector({ record, asset, onChange, onClose }: { record: ProductionBreakdown; asset: ProductionAsset; onChange: (record: ProductionBreakdown) => void; onClose: () => void }) {
  const [name, setName] = useState(asset.name);
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
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const mergeOptions = useMemo(() => record.assets.filter((item) => item.id !== asset.id && item.category === asset.category), [record.assets, asset.id, asset.category]);
  const requirements = record.requirements.filter((item) => asset.requirementIds.includes(item.id) && !item.unnecessary);
  const sceneLabels = asset.requiredSceneIds.map((id) => record.scenes.find((scene) => scene.id === id)?.slugline ?? id);

  const save = () => {
    onChange(editAsset(record, asset.id, {
      name,
      category,
      canonicalSpec: {
        ...asset.canonicalSpec,
        identity,
        visualDescription: description,
        continuityLocks: commaList(locks),
        negativeRequirements: commaList(negative),
        prohibitedFeatures: commaList(prohibited),
      },
    }));
  };

  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const uri = await readFile(file);
    onChange(attachReference(record, asset.id, {
      id: uid("reference"), name: file.name, uri, mediaType: file.type, preferred: asset.references.length === 0,
      uploadedAt: Date.now(),
      provenance: { sourceType: "user", screenplayVersionId: record.screenplayVersionId, sceneIds: asset.requiredSceneIds, createdAt: Date.now() },
    }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-bg/70" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close asset inspector" />
      <aside role="dialog" aria-modal="true" aria-labelledby="asset-inspector-title" className="absolute inset-y-0 right-0 flex w-full max-w-xl min-w-0 flex-col border-l border-border bg-surface shadow-2xl sm:w-11/12">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0"><p className="text-[11px] tracking-wide text-subtle uppercase">Asset inspector</p><h2 id="asset-inspector-title" className="mt-1 truncate font-display text-2xl tracking-tight" title={asset.name}>{asset.name}</h2><div className="mt-2 flex flex-wrap gap-2"><ReadinessBadge readiness={asset.readiness} />{asset.hero ? <Badge>Hero asset</Badge> : null}{asset.stale ? <Badge className="text-rec">Stale</Badge> : null}</div></div>
          <Button size="icon-sm" variant="ghost" aria-label="Close inspector" onClick={onClose}><X /></Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-5">
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
            <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={save}>Save changes</Button><Button disabled={!description.trim()} onClick={() => onChange(approveCanonicalSpec(editAsset(record, asset.id, { name, category, canonicalSpec: { ...asset.canonicalSpec, identity, visualDescription: description, continuityLocks: commaList(locks), negativeRequirements: commaList(negative), prohibitedFeatures: commaList(prohibited) } }), asset.id))}><Check /> Approve specification</Button></div>
          </section>

          <Divider />
          <section>
            <SectionHeading title="Required scenes" detail={`${sceneLabels.length} screenplay links`} />
            <ul className="mt-2 grid gap-1">{sceneLabels.map((label) => <li key={label} className="break-words rounded-sm bg-inset px-3 py-2 text-xs text-muted">{label}</li>)}</ul>
          </section>

          <Divider />
          <section>
            <SectionHeading title="References" detail={asset.referenceRequired ? "At least one reference required" : "Optional"} />
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
              {asset.references.map((reference) => <div key={reference.id} className="min-w-0 rounded-md bg-inset p-2 shadow-[var(--shadow-border)]"><img src={reference.uri} alt="" className="aspect-square w-full rounded-sm object-cover" /><p className="mt-1 truncate text-[10px] text-muted" title={reference.name}>{reference.name}</p><button type="button" className="mt-1 inline-flex h-9 w-full items-center justify-center gap-1 rounded-sm text-[10px] text-muted hover:bg-elevated hover:text-fg" onClick={() => onChange(setPreferredReference(record, asset.id, reference.id))}><Star className="size-3" /> {reference.preferred ? "Preferred" : "Prefer"}</button></div>)}
              <label className="grid min-h-32 cursor-pointer place-items-center rounded-md bg-inset p-3 text-center text-xs text-muted shadow-[var(--shadow-border)] hover:text-fg"><span><ImagePlus className="mx-auto size-4" /><span className="mt-1 block">Upload reference</span></span><input className="sr-only" type="file" accept="image/*" onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} /></label>
            </div>
          </section>

          <Divider />
          <section>
            <SectionHeading title="Variants" detail={`${asset.variants.length} continuity states`} />
            <ul className="mt-2 grid gap-2">{asset.variants.map((variant) => <li key={variant.id} className="flex min-w-0 items-center justify-between gap-2 rounded-sm bg-inset px-3 py-2"><div className="min-w-0"><p className="truncate text-xs">{variant.name}</p><p className="text-[10px] text-subtle">{variant.requiredSceneIds.length} scenes{variant.stale ? " · stale" : ""}</p></div><Button size="icon-sm" variant="ghost" aria-label={`Remove ${variant.name}`} onClick={() => onChange(removeAssetVariant(record, asset.id, variant.id))}><Trash2 /></Button></li>)}</ul>
            <div className="mt-2 flex gap-2"><Input value={variantName} onChange={(event) => setVariantName(event.target.value)} placeholder="New variant name" /><Button size="icon" variant="secondary" aria-label="Add variant" disabled={!variantName.trim()} onClick={() => { onChange(addAssetVariant(record, asset.id, { id: uid("variant"), name: variantName.trim(), requiredSceneIds: asset.requiredSceneIds, requirementIds: asset.requirementIds, specPatch: { continuityLocks: [variantName.trim()] }, stale: false, staleReasons: [] })); setVariantName(""); }}><Plus /></Button></div>
          </section>

          <Divider />
          <section>
            <SectionHeading title="Breakdown requirements" detail="User-correctable extraction evidence" />
            <ul className="mt-2 grid gap-2">{requirements.map((requirement) => <li key={requirement.id} className="rounded-sm bg-inset px-3 py-2"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-xs">{requirement.name}</p><p className="mt-1 break-words text-[10px] leading-relaxed text-subtle">{requirement.description}</p></div>{requirement.confidence ? <Badge>{requirement.confidence}</Badge> : null}</div><button type="button" className="mt-2 h-9 text-[10px] text-muted hover:text-fg" onClick={() => onChange(markRequirementUnnecessary(record, requirement.id))}>Mark unnecessary</button></li>)}</ul>
          </section>

          {mergeOptions.length || requirements.length > 1 ? <Divider /> : null}
          {mergeOptions.length ? <section><SectionHeading title="Merge duplicate" detail="Combine another asset into this identity" /><div className="mt-2 flex gap-2"><select className="h-11 min-w-0 flex-1 rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]" value={mergeId} onChange={(event) => setMergeId(event.target.value)}><option value="">Choose duplicate</option>{mergeOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button variant="secondary" disabled={!mergeId} onClick={() => { onChange(mergeAssets(record, asset.id, [mergeId])); setMergeId(""); }}><GitMerge /> Merge</Button></div></section> : null}
          {requirements.length > 1 ? <section className="mt-5"><SectionHeading title="Split asset" detail="Move one requirement into a separate asset" /><div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><select className="h-11 min-w-0 rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]" value={splitRequirementId} onChange={(event) => setSplitRequirementId(event.target.value)}><option value="">Choose requirement</option>{requirements.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Input value={splitName} onChange={(event) => setSplitName(event.target.value)} placeholder="New asset name" /><Button variant="secondary" disabled={!splitRequirementId || !splitName.trim()} onClick={() => { onChange(splitAsset(record, asset.id, { id: uid("asset"), name: splitName.trim(), requirementIds: [splitRequirementId] })); setSplitName(""); setSplitRequirementId(""); }}><Split /> Split</Button></div></section> : null}

          <Divider />
          <section><SectionHeading title="Preparation status" detail="Saved, queued, and waiting for explicit generation" /><div className="mt-2 rounded-md bg-inset p-3 text-xs text-muted shadow-[var(--shadow-border)]"><div className="flex items-center gap-2"><GitPullRequestArrow className="size-4 text-accent" /><ReadinessBadge readiness={asset.readiness} /></div><p className="mt-2 leading-relaxed">{asset.referenceRequired && !asset.references.length ? "Waiting for a required reference." : asset.canonicalApproved ? "Canonical specification is approved for preparation." : "Approve the canonical specification before generation can be ready."}</p></div></section>
        </div>
      </aside>
    </div>
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

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read reference image."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}
