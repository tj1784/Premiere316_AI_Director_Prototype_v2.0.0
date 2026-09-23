import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import type { ResearchConfidence } from "@/lib/research/confidence.ts";
import { confidenceLabel, recordedResearchDisputes, unverifiedResearchDisputeNotes, type ResearchDisputeInput } from "@/lib/research/source-ledger.ts";
import type { ResearchContent, ResearchSource } from "@/lib/research/bible.ts";

type SourceLedgerPanelProps = {
  content: ResearchContent;
  onRecordDispute?: (input: ResearchDisputeInput) => void;
  onResolveDispute?: (disputeId: string, note: string) => void;
  onClassifySource?: (sourceId: string, confidence: ResearchConfidence) => void;
};

export function SourceLedgerPanel({ content, onRecordDispute, onResolveDispute, onClassifySource }: SourceLedgerPanelProps) {
  const disputes = recordedResearchDisputes(content);
  const olderNotes = unverifiedResearchDisputeNotes(content);
  const quotableSources = content.sources.filter((source) => source.quote.trim());
  return (
    <div className="grid gap-4">
      <div>
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Sources & disputes</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">Source text stays with this picture. Record a disagreement only when two quoted passages address the same claim and actually conflict.</p>
      </div>
      <ul className="grid gap-2">
        {content.sources.map((source) => (
          <li key={source.id} className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]">
            <p className="text-xs">{source.title}</p>
            {onClassifySource ? (
              <label className="mt-2 grid max-w-64 gap-1 text-[11px] text-subtle">
                Evidence class
                <select value={source.confidence} onChange={(event) => onClassifySource(source.id, event.target.value as ResearchConfidence)} className="h-8 rounded-sm bg-inset px-2 text-xs text-fg shadow-[var(--shadow-border)]">
                  <option value="A">A · Explicit source / Scripture</option>
                  <option value="B">B · Strong evidence</option>
                  <option value="C">C · Reconstruction</option>
                  <option value="D">D · Disputed interpretation</option>
                </select>
              </label>
            ) : <p className="mt-1 text-[11px] text-subtle">{confidenceLabel(source.confidence)}</p>}
            {source.locator ? <p className="mt-1 truncate text-[11px] text-muted" title={source.locator}>{source.locator}</p> : null}
            {source.quote ? source.quote.length > 360 ? (
              <details className="mt-2 text-xs leading-relaxed text-muted">
                <summary className="cursor-pointer break-words">{source.quote.slice(0, 360)}… Read complete source</summary>
                <p className="mt-3 whitespace-pre-wrap break-words">{source.quote}</p>
              </details>
            ) : <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted">{source.quote}</p> : null}
          </li>
        ))}
      </ul>
      <div className="grid gap-2">
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Recorded disagreements · {disputes.length}</p>
        {!disputes.length && <p className="text-xs text-muted">No claim-specific disagreement has been recorded.</p>}
        {disputes.map((dispute) => (
          <article key={dispute.id} className="rounded-md bg-inset px-3 py-2 text-xs text-muted">
            <p className="font-medium text-fg">{dispute.claim}</p>
            {dispute.evidence.map((item) => (
              <div key={item.sourceId} className="mt-2 border-l border-border pl-2">
                <span className="text-[11px] text-subtle">{content.sources.find((source) => source.id === item.sourceId)?.title ?? item.sourceId}</span>
                <p className="mt-1 whitespace-pre-wrap break-words">{item.excerpt}</p>
              </div>
            ))}
            {dispute.resolution ? (
              <p className="mt-2 whitespace-pre-wrap border-t border-border pt-2">Resolution: {dispute.resolution.note}</p>
            ) : onResolveDispute ? (
              <details className="mt-2 border-t border-border pt-2">
                <summary className="cursor-pointer">Resolve this claim</summary>
                <form className="mt-2 grid gap-2" onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const note = String(new FormData(form).get("resolution") ?? "").trim();
                  if (!note) return;
                  onResolveDispute(dispute.id, note);
                }}>
                  <Textarea name="resolution" required className="min-h-16" aria-label={`Resolution for ${dispute.claim}`} placeholder="Explain this claim's resolution; retain both sources" />
                  <Button type="submit" size="sm" variant="secondary">Record resolution</Button>
                </form>
              </details>
            ) : null}
          </article>
        ))}
        {olderNotes.length > 0 && <details className="rounded-md bg-inset px-3 py-2 text-xs text-muted">
          <summary className="cursor-pointer">Older notes without paired source evidence · {olderNotes.length}</summary>
          <ul className="mt-2 grid gap-2">{olderNotes.map((item) => <li key={item.id} className="whitespace-pre-wrap break-words">{item.claim}</li>)}</ul>
        </details>}
      </div>
      {onRecordDispute && quotableSources.length >= 2 && (
        <details className="rounded-md bg-inset px-3 py-2 text-xs text-muted">
          <summary className="cursor-pointer text-fg">Record a claim disagreement</summary>
          <form className="mt-3 grid gap-2" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            onRecordDispute({
              claim: String(data.get("claim") ?? ""),
              sourceAId: String(data.get("sourceA") ?? ""),
              sourceAExcerpt: String(data.get("evidenceA") ?? ""),
              sourceBId: String(data.get("sourceB") ?? ""),
              sourceBExcerpt: String(data.get("evidenceB") ?? ""),
            });
          }}>
            <Input name="claim" required aria-label="Conflicting claim" placeholder="Specific disputed claim" />
            <label className="grid gap-1">First source
              <select name="sourceA" defaultValue={quotableSources[0].id} className="h-8 min-w-0 rounded-sm bg-elevated px-2 text-xs text-fg">{quotableSources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select>
            </label>
            <Textarea name="evidenceA" required className="min-h-16" aria-label="Exact excerpt from first source" placeholder="Exact excerpt from its source text" />
            <label className="grid gap-1">Second source
              <select name="sourceB" defaultValue={quotableSources[1].id} className="h-8 min-w-0 rounded-sm bg-elevated px-2 text-xs text-fg">{quotableSources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select>
            </label>
            <Textarea name="evidenceB" required className="min-h-16" aria-label="Exact excerpt from second source" placeholder="Exact excerpt from its source text" />
            <p className="text-[11px]">Excerpts must appear in their source texts. This records your identified disagreement; it does not classify either source as false.</p>
            <Button type="submit" size="sm" variant="secondary">Record disagreement</Button>
          </form>
        </details>
      )}
    </div>
  );
}

export function AddSourceForm({ onAdd }: { onAdd: (source: Omit<ResearchSource, "id" | "createdAt">) => void }) {
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
