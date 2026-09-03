import { useState } from "react";
import { Check, GitBranch, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { BibleNav } from "./bible-nav";
import { SourceLedgerPanel } from "./source-ledger-panel";
import { SocialWorldPanel } from "./social-world-panel";
import {
  cloneResearchContent,
  saveResearchDraft,
  type PictureResearchBible,
  type ResearchContent,
  type ResearchSource,
} from "@/lib/research/bible.ts";
import { addResearchSource, disputesForSources } from "@/lib/research/source-ledger.ts";
import { approveResearchOrError } from "@/lib/research/research-approval.ts";
import { startDeltaResearch } from "@/lib/research/delta-research.ts";
import { uid } from "@/lib/utils";

function statusLabel(status: PictureResearchBible["status"]): string {
  if (status === "APPROVED") return "Research approved";
  if (status === "DELTA_PENDING") return "Delta pending";
  if (status === "IN_REVIEW") return "In review";
  return "Draft";
}

export function ResearchWorkspace({
  title,
  bible,
  onChange,
}: {
  title: string;
  bible: PictureResearchBible;
  onChange: (bible: PictureResearchBible) => void;
}) {
  const [section, setSection] = useState("sources");
  const [draft, setDraft] = useState<ResearchContent>(cloneResearchContent(bible.content));

  const persistContent = (content: ResearchContent) => {
    setDraft(content);
    onChange({ ...bible, content, updatedAt: Date.now() });
  };

  const addSource = (partial: Omit<ResearchSource, "id" | "createdAt">) => {
    const now = Date.now();
    const added = addResearchSource(draft.sources, { ...partial, id: uid("src"), createdAt: now });
    if ("error" in added) {
      toast.error(added.error);
      return;
    }
    persistContent({
      ...draft,
      sources: added.sources,
      disputes: disputesForSources(added.sources, draft.disputes, now),
    });
  };

  return (
    <div className="grid h-full min-h-0 min-w-0 lg:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)_minmax(14rem,18rem)]">
      <aside className="hidden min-h-0 overflow-y-auto border-r border-border p-3 lg:block">
        <p className="mb-3 text-[10px] tracking-[0.2em] text-subtle uppercase">Bible</p>
        <BibleNav bible={{ ...bible, content: draft }} active={section} onSelect={setSection} />
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">02 · Research</p>
              <h2 className="mt-1 font-display text-xl tracking-tight">{title || "Picture Research"}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{statusLabel(bible.status)}</Badge>
              <Badge>{draft.mode === "local-only" ? "Local only" : "Web-assisted unavailable"}</Badge>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">
            Build the Picture Research Bible before screenplay generation. No generation rails. No cloud fallback.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {section === "sources" ? <SourceLedgerPanel content={draft} onChange={persistContent} onAdd={addSource} /> : null}
          {section === "social" ? <SocialWorldPanel content={draft} onChange={persistContent} /> : null}
          {section === "camera" ? (
            <div className="grid max-w-3xl gap-3">
              <p className="text-xs leading-relaxed text-muted">Picture-level cinematography research. This does not rewrite shots or prompts.</p>
              {([
                ["thesis", "Thesis"],
                ["lensLanguage", "Lens language"],
                ["lighting", "Lighting"],
                ["geography", "Geography"],
                ["movement", "Movement"],
                ["texture", "Texture / grain"],
                ["soundWorld", "Sound world"],
                ["musicResearch", "Music research"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <Textarea className="mt-1.5" value={draft.cinematographyManifesto[key]} onChange={(event) => persistContent({ ...draft, cinematographyManifesto: { ...draft.cinematographyManifesto, [key]: event.target.value } })} />
                </div>
              ))}
            </div>
          ) : null}
          {section === "risks" ? (
            <div className="grid max-w-3xl gap-3">
              <div>
                <Label>Risks / disputes</Label>
                <Textarea className="mt-1.5 min-h-32" value={draft.risks} onChange={(event) => persistContent({ ...draft, risks: event.target.value })} />
              </div>
              <div>
                <Label>AI production feasibility</Label>
                <Textarea className="mt-1.5 min-h-32" value={draft.feasibility} onChange={(event) => persistContent({ ...draft, feasibility: event.target.value })} />
              </div>
            </div>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const saved = saveResearchDraft(bible, draft, uid("rsv"));
                if ("error" in saved) {
                  toast.error(saved.error);
                  return;
                }
                onChange(saved);
                toast.success("Research draft saved.");
              }}
            >
              <Save />Save research
            </Button>
            <Button
              variant="secondary"
              disabled={!bible.approvedVersionId}
              onClick={() => {
                onChange(startDeltaResearch(bible, draft, uid("rsv")));
                toast.message("Delta Research opened. Approved notes remain.");
              }}
            >
              <GitBranch />Delta Research
            </Button>
            <Button
              className="ml-auto"
              disabled={bible.status === "APPROVED"}
              onClick={() => {
                const approved = approveResearchOrError({ ...bible, content: draft }, uid("rsv"));
                if ("error" in approved) {
                  toast.error(approved.error);
                  return;
                }
                onChange(approved);
                toast.success("Research Bible approved.");
              }}
            >
              <Check />Approve research
            </Button>
          </div>
        </footer>
      </section>

      <aside className="hidden min-h-0 overflow-y-auto border-l border-border p-4 lg:block">
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Mode</p>
        <select
          aria-label="Research mode"
          className="mt-3 h-9 w-full rounded-sm bg-elevated px-2 text-xs text-fg shadow-[var(--shadow-border)]"
          value={draft.mode}
          onChange={(event) => persistContent({ ...draft, mode: event.target.value as ResearchContent["mode"] })}
        >
          <option value="local-only">Local / user-provided</option>
          <option value="web-assisted-opt-in">Web-assisted (unavailable)</option>
        </select>
        {draft.mode === "web-assisted-opt-in" ? (
          <p className="mt-3 text-xs leading-relaxed text-muted">Web-assisted research is not authorized. The flag is stored locally and does not browse or call a network.</p>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-muted">Sources stay on this machine. Nothing is fetched automatically.</p>
        )}
        <div className="my-5 border-t border-border" />
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Versions</p>
        <ol className="mt-3 grid gap-2">
          {[...bible.versions].reverse().map((version) => (
            <li key={version.id} className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]">
              <p className="truncate text-xs">{version.label}</p>
              <p className="mt-1 text-[10px] text-subtle">{version.scope} · {new Date(version.createdAt).toLocaleString()}</p>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
