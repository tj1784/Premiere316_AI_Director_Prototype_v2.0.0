import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import {
  PRODUCTION_CATEGORIES,
  addMissingAsset,
  type ProductionBreakdown,
  type ProductionCategory,
} from "@/lib/production";
import { uid } from "@/lib/utils";
import { PRODUCTION_CATEGORY_LABELS } from "./inventory-constants";

export function AddAssetDialog({ record, onChange, onClose }: {
  record: ProductionBreakdown;
  onChange: (record: ProductionBreakdown) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductionCategory>("prop");
  const [description, setDescription] = useState("");
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const [hero, setHero] = useState(false);
  const [referenceRequired, setReferenceRequired] = useState(false);

  const add = () => {
    if (!name.trim() || !description.trim() || !sceneIds.length) return;
    onChange(addMissingAsset(record, {
      assetId: uid("asset"),
      requirementId: uid("requirement"),
      name: name.trim(),
      category,
      description: description.trim(),
      sceneIds,
      hero,
      referenceRequired,
    }));
  };

  return (
    <section aria-labelledby={titleId} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border/65 bg-surface/75" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/65 px-4 py-3">
          <div>
            <p className="text-[11px] tracking-wide text-subtle uppercase">Manual breakdown correction</p>
            <h2 id={titleId} className="mt-1 font-display text-2xl tracking-tight">Add missing asset</h2>
            <p className="mt-1 text-xs text-muted">Link every manual production element back to an approved scene.</p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close add asset form" onClick={onClose}><X /></Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-asset-name">Asset name</Label>
              <Input id="new-asset-name" className="mt-1.5" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Passover table" />
            </div>
            <div>
              <Label htmlFor="new-asset-category">Category</Label>
              <select id="new-asset-category" className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)] outline-none" value={category} onChange={(event) => setCategory(event.target.value as ProductionCategory)}>
                {PRODUCTION_CATEGORIES.map((item) => <option key={item} value={item}>{PRODUCTION_CATEGORY_LABELS[item]}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="new-asset-description">Canonical description</Label>
              <Textarea id="new-asset-description" className="mt-1.5 min-h-28" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the production identity and continuity requirements without engine-specific syntax." />
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="text-sm">Required scenes</legend>
            <p className="mt-0.5 text-[10px] text-subtle">Choose at least one approved screenplay scene.</p>
            <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto border-y border-border/60 py-2 sm:grid-cols-2">
              {record.scenes.map((scene) => {
                const checked = sceneIds.includes(scene.id);
                return (
                  <label key={scene.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-xs hover:bg-elevated">
                    <input type="checkbox" className="mt-0.5 accent-current" checked={checked} onChange={() => setSceneIds((current) => checked ? current.filter((id) => id !== scene.id) : [...current, scene.id])} />
                    <span className="min-w-0 break-words text-muted"><span className="block text-fg">{scene.slugline}</span><span className="mt-0.5 block text-[10px] text-subtle">{scene.id}</span></span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-4 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-2">
            <Toggle checked={hero} onChange={setHero} label="Hero asset" detail="Prioritize continuity and review." />
            <Toggle checked={referenceRequired} onChange={setReferenceRequired} label="Reference required" detail="Block readiness until imagery is attached." />
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border/65 px-4 py-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || !description.trim() || !sceneIds.length} onClick={add}><Plus /> Add asset</Button>
        </footer>
    </section>
  );
}

function Toggle({ checked, onChange, label, detail }: { checked: boolean; onChange: (value: boolean) => void; label: string; detail: string }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-start gap-3 px-2 py-2.5">
      <input type="checkbox" className="mt-0.5 accent-current" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span><span className="block text-xs text-fg">{label}</span><span className="mt-0.5 block text-[10px] leading-relaxed text-subtle">{detail}</span></span>
    </label>
  );
}
