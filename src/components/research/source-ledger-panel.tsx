import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
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

const SOURCE_VIEWS = [
  ["references", "Bible & sources"],
  ["authority", "Authority"],
  ["conflicts", "Conflicts"],
] as const;
type SourceView = (typeof SOURCE_VIEWS)[number][0];

export function SourceLedgerPanel({ content, onRecordDispute, onResolveDispute, onClassifySource }: SourceLedgerPanelProps) {
  const [view, setView] = useState<SourceView>("references");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const activeSource = content.sources.find((source) => source.id === selectedSourceId) ?? content.sources[0];
  const disputes = recordedResearchDisputes(content);
  const olderNotes = unverifiedResearchDisputeNotes(content);
  const quotableSources = content.sources.filter((source) => source.quote.trim());
  const sourceLink = activeSource && /^https?:\/\//i.test(activeSource.locator) ? activeSource.locator : null;

  return (
    <div className="research-source-ledger">
      <nav className="research-source-views" aria-label="Source evidence views">
        {SOURCE_VIEWS.map(([id, label]) => (
          <button type="button" key={id} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
            {label}{id === "conflicts" && disputes.length ? ` · ${disputes.length}` : ""}
          </button>
        ))}
      </nav>

      {view === "references" && (
        <div className="research-evidence-view">
          <label className="research-source-picker">
            <span>Reference · {content.sources.length} recorded</span>
            <select value={activeSource?.id ?? ""} onChange={(event) => setSelectedSourceId(event.target.value)} disabled={!content.sources.length}>
              {!content.sources.length && <option value="">No references yet</option>}
              {content.sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}
            </select>
          </label>
          {activeSource ? (
            <article className="research-active-source">
              <div className="research-active-source-heading">
                <h3>{activeSource.title}</h3>
                <span title={confidenceLabel(activeSource.confidence)}>Class {activeSource.confidence}</span>
              </div>
              {activeSource.locator && (
                sourceLink ? <a href={sourceLink} target="_blank" rel="noopener noreferrer">Open cited reference <ArrowUpRight size={14} aria-hidden="true" /></a>
                  : <p className="research-source-locator">{activeSource.locator}</p>
              )}
              {activeSource.quote ? (
                <p className="research-source-quotation">{activeSource.quote}</p>
              ) : (
                <p className="research-source-no-quote">Citation recorded. The source text has not been imported; open the reference to inspect it.</p>
              )}
            </article>
          ) : <p className="research-source-no-quote">Add source material to start a traceable research ledger.</p>}
          {content.sources.length > 1 && <p className="research-source-navigation">Choose another reference above to inspect its full title, citation and source text.</p>}
        </div>
      )}

      {view === "authority" && (
        <div className="research-evidence-view research-authority-view">
          <p>Classify each cited source by what its evidence supports. Scripture and direct source text are class A; a reconstruction stays class C.</p>
          {!content.sources.length && <p>No sources to classify yet.</p>}
          <ul>
            {content.sources.map((source) => (
              <li key={source.id}>
                <span>{source.title}</span>
                {onClassifySource ? (
                  <select aria-label={`Evidence class for ${source.title}`} value={source.confidence} onChange={(event) => onClassifySource(source.id, event.target.value as ResearchConfidence)}>
                    <option value="A">A · Explicit source / Scripture</option>
                    <option value="B">B · Strong evidence</option>
                    <option value="C">C · Reconstruction</option>
                    <option value="D">D · Disputed interpretation</option>
                  </select>
                ) : <small>{confidenceLabel(source.confidence)}</small>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === "conflicts" && (
        <div className="research-evidence-view research-conflicts-view">
          <p>Record a disagreement only when quoted passages address the same claim and actually conflict.</p>
          {!disputes.length && <p>No claim-specific disagreement has been recorded.</p>}
          {disputes.map((dispute) => (
            <article key={dispute.id} className="research-dispute">
              <h3>{dispute.claim}</h3>
              {dispute.evidence.map((item) => (
                <div key={item.sourceId}>
                  <strong>{content.sources.find((source) => source.id === item.sourceId)?.title ?? item.sourceId}</strong>
                  <p>{item.excerpt}</p>
                </div>
              ))}
              {dispute.resolution ? (
                <p>Resolution: {dispute.resolution.note}</p>
              ) : onResolveDispute ? (
                <details>
                  <summary>Resolve this claim</summary>
                  <form onSubmit={(event) => {
                    event.preventDefault();
                    const note = String(new FormData(event.currentTarget).get("resolution") ?? "").trim();
                    if (note) onResolveDispute(dispute.id, note);
                  }}>
                    <Textarea name="resolution" required aria-label={`Resolution for ${dispute.claim}`} placeholder="Explain the resolution; retain both sources" />
                    <Button type="submit" size="sm" variant="secondary">Record resolution</Button>
                  </form>
                </details>
              ) : null}
            </article>
          ))}
          {olderNotes.length > 0 && <details className="research-dispute">
            <summary>Older notes without paired source evidence · {olderNotes.length}</summary>
            <ul>{olderNotes.map((item) => <li key={item.id}>{item.claim}</li>)}</ul>
          </details>}
          {onRecordDispute && quotableSources.length >= 2 && (
            <details className="research-dispute">
              <summary>Record a claim disagreement</summary>
              <form onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                onRecordDispute({
                  claim: String(data.get("claim") ?? ""),
                  sourceAId: String(data.get("sourceA") ?? ""),
                  sourceAExcerpt: String(data.get("evidenceA") ?? ""),
                  sourceBId: String(data.get("sourceB") ?? ""),
                  sourceBExcerpt: String(data.get("evidenceB") ?? ""),
                });
              }}>
                <Input name="claim" required aria-label="Conflicting claim" placeholder="Specific disputed claim" />
                <label>First source
                  <select name="sourceA" defaultValue={quotableSources[0].id}>{quotableSources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select>
                </label>
                <Textarea name="evidenceA" required aria-label="Exact excerpt from first source" placeholder="Exact excerpt from its source text" />
                <label>Second source
                  <select name="sourceB" defaultValue={quotableSources[1].id}>{quotableSources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select>
                </label>
                <Textarea name="evidenceB" required aria-label="Exact excerpt from second source" placeholder="Exact excerpt from its source text" />
                <p>Excerpts must appear in their source texts. Both references remain in the ledger.</p>
                <Button type="submit" size="sm" variant="secondary">Record disagreement</Button>
              </form>
            </details>
          )}
          {onRecordDispute && quotableSources.length < 2 && <p>Add exact source text for two references before recording a disagreement.</p>}
        </div>
      )}
    </div>
  );
}

export function AddSourceForm({ onAdd }: { onAdd: (source: Omit<ResearchSource, "id" | "createdAt">) => void }) {
  return (
    <form className="research-add-source-form" onSubmit={(event) => {
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
    }}>
      <p>Add source</p>
      <Input name="title" required placeholder="Title" aria-label="Source title" />
      <Input name="locator" placeholder="Locator / citation" aria-label="Source citation" />
      <Textarea name="quote" placeholder="Exact source text" aria-label="Exact source text" />
      <select name="confidence" aria-label="Source confidence" defaultValue="C">
        <option value="A">A · Explicit source</option>
        <option value="B">B · Strong evidence</option>
        <option value="C">C · Reconstruction</option>
        <option value="D">D · Disputed</option>
      </select>
      <Button type="submit" size="sm" variant="secondary">Add source</Button>
    </form>
  );
}
