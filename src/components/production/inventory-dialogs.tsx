import { useEffect, useId, useRef, useState } from "react";
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
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter((item) => item.offsetParent !== null);
      if (!focusable.length) return;
      const firstItem = focusable[0]!;
      const lastItem = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [onClose]);

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
    <div className="fixed inset-0 z-[60] grid place-items-center bg-bg/75 p-3 sm:p-6" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close add asset dialog" onClick={onClose} />
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex max-h-full w-full max-w-2xl min-w-0 flex-col overflow-hidden rounded-lg bg-surface shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            <p className="text-[11px] tracking-wide text-subtle uppercase">Manual breakdown correction</p>
            <h2 id={titleId} className="mt-1 font-display text-2xl tracking-tight">Add missing asset</h2>
            <p className="mt-1 text-xs text-muted">Link every manual production element back to an approved scene.</p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close dialog" onClick={onClose}><X /></Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
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
            <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto rounded-md bg-inset p-2 shadow-[var(--shadow-border)] sm:grid-cols-2">
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

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Toggle checked={hero} onChange={setHero} label="Hero asset" detail="Prioritize continuity and review." />
            <Toggle checked={referenceRequired} onChange={setReferenceRequired} label="Reference required" detail="Block readiness until imagery is attached." />
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || !description.trim() || !sceneIds.length} onClick={add}><Plus /> Add asset</Button>
        </footer>
      </section>
    </div>
  );
}

function Toggle({ checked, onChange, label, detail }: { checked: boolean; onChange: (value: boolean) => void; label: string; detail: string }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-md bg-inset px-3 py-2.5 shadow-[var(--shadow-border)]">
      <input type="checkbox" className="mt-0.5 accent-current" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span><span className="block text-xs text-fg">{label}</span><span className="mt-0.5 block text-[10px] leading-relaxed text-subtle">{detail}</span></span>
    </label>
  );
}
