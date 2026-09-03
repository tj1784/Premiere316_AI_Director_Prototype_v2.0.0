import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import type { ResearchConfidence } from "@/lib/research/confidence.ts";
import { confidenceLabel } from "@/lib/research/source-ledger.ts";
import type { ResearchContent, ResearchSource } from "@/lib/research/bible.ts";

export function SourceLedgerPanel({
  content,
  onChange,
  onAdd,
}: {
  content: ResearchContent;
  onChange: (content: ResearchContent) => void;
  onAdd: (source: Omit<ResearchSource, "id" | "createdAt">) => void;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Sources & disputes</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">Local and user-provided only. Web-assisted research is listed but not connected.</p>
      </div>
      <ul className="grid gap-2">
        {content.sources.map((source) => (
          <li key={source.id} className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]">
            <p className="text-xs">{source.title}</p>
            <p className="mt-1 text-[11px] text-subtle">{confidenceLabel(source.confidence)}</p>
            {source.locator ? <p className="mt-1 truncate text-[11px] text-muted" title={source.locator}>{source.locator}</p> : null}
            {source.quote ? <p className="mt-2 text-xs leading-relaxed text-muted">{source.quote}</p> : null}
          </li>
        ))}
      </ul>
      {content.disputes.map((dispute) => (
        <p key={dispute.id} className="rounded-md bg-inset px-3 py-2 text-xs text-muted">{dispute.claim}</p>
      ))}
      <AddSourceForm onAdd={onAdd} />
      <div>
        <Label>Research notes</Label>
        <Textarea className="mt-1.5 min-h-24" value={content.notes} onChange={(event) => onChange({ ...content, notes: event.target.value })} />
      </div>
    </div>
  );
}

function AddSourceForm({ onAdd }: { onAdd: (source: Omit<ResearchSource, "id" | "createdAt">) => void }) {
  return (
    <form
      className="grid gap-2 rounded-md bg-inset p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        onAdd({
          title: String(data.get("title") ?? ""),
          locator: String(data.get("locator") ?? ""),
          quote: String(data.get("quote") ?? ""),
          confidence: String(data.get("confidence") ?? "C") as ResearchConfidence,
          importedFrom: null,
        });
        form.reset();
      }}
    >
      <p className="text-[10px] tracking-wide text-subtle uppercase">Add source</p>
      <Input name="title" required placeholder="Title" />
      <Input name="locator" placeholder="Locator / citation" />
      <Textarea name="quote" className="min-h-20" placeholder="Quote" />
      <select name="confidence" aria-label="Source confidence" className="h-9 rounded-sm bg-elevated px-2 text-xs text-fg shadow-[var(--shadow-border)]" defaultValue="C">
        <option value="A">A · Explicit source</option>
        <option value="B">B · Strong evidence</option>
        <option value="C">C · Reconstruction</option>
        <option value="D">D · Disputed</option>
      </select>
      <Button type="submit" size="sm" variant="secondary">Add source</Button>
    </form>
  );
}
