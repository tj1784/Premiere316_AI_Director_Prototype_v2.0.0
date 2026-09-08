import { useRef, useState } from "react";
import { Check, FolderPlus, GitBranch, RefreshCw, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { BibleNav } from "./bible-nav";
import { SourceLedgerPanel, AddSourceForm } from "./source-ledger-panel";
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
import {
  RESEARCH_EMPTY_SECTIONS,
  RESEARCH_MANUAL_SUMMARY,
  RESEARCH_ROOM_PRIMARY_CTA,
  RESEARCH_ROOM_REGENERATE_CTA,
  RESEARCH_SOURCE_MATERIAL_CTA,
  researchBibleGenerated,
  researchRoomView,
} from "@/lib/research/research-room.ts";
import { uid } from "@/lib/utils";
import type { Character, Asset } from "@/lib/studio/types";
import { useStudio } from "@/lib/studio/store";

export function ResearchWorkspace({
  title,
  bible,
  llamaAvailable,
  characters = [],
  locations = [],
  onChange,
  onRescan,
  onBuildDraft,
  building = false,
}: {
  title: string;
  bible: PictureResearchBible;
  llamaAvailable: boolean | null;
  characters?: Character[];
  locations?: Asset[];
  onChange: (bible: PictureResearchBible) => void;
  onRescan: () => void;
  onBuildDraft: () => Promise<void>;
  building?: boolean;
}) {
  const [section, setSection] = useState("overview");
  const [draft, setDraft] = useState<ResearchContent>(cloneResearchContent(bible.content));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const manualRef = useRef<HTMLDetailsElement>(null);
  const packRef = useRef<HTMLInputElement>(null);
  const returnToDefaultMode = useStudio((state) => state.returnToDefaultMode);
  const view = researchRoomView(bible, llamaAvailable);

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

  const openManualNotes = () => {
    if (manualRef.current) manualRef.current.open = true;
    manualRef.current?.scrollIntoView({ block: "nearest" });
  };

  const addSourceMaterial = () => packRef.current?.click();

  const buildResearchDraft = () => {
    if (llamaAvailable === false) {
      toast.error(view.offlineTitle + " " + view.offlineBody);
      return;
    }
    void onBuildDraft();
  };

  const generated = researchBibleGenerated(bible);

  return (
    <div
      className="grid h-full min-h-0 min-w-0 lg:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)_minmax(14rem,18rem)]"
      data-research-room="true"
      data-research-status={view.status}
      data-research-empty={view.showEmptyState ? "true" : "false"}
      data-research-offline={view.showOffline ? "true" : "false"}
      data-research-mode-panel="false"
    >
      <aside className="hidden min-h-0 overflow-y-auto border-r border-border p-3 lg:block">
        <p className="mb-3 text-[10px] tracking-[0.2em] text-subtle uppercase">Bible</p>
        <button
          type="button"
          className={`mb-1 w-full rounded-sm px-2 py-2 text-left text-xs ${section === "overview" ? "bg-elevated text-fg" : "text-muted hover:bg-elevated hover:text-fg"}`}
          aria-current={section === "overview" ? "true" : undefined}
          onClick={() => setSection("overview")}
        >
          Room overview
        </button>
        {generated ? <BibleNav bible={{ ...bible, content: draft }} active={section} onSelect={setSection} /> : (
          <p className="mt-3 text-[11px] leading-relaxed text-muted">No Research Bible has been generated yet. Build a research draft instead of filling a worksheet.</p>
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Research Room</p>
              <h2 className="mt-1 font-display text-xl tracking-tight">{title || "Picture Research"}</h2>
            </div>
            <Badge>{view.statusLabel}</Badge>
          </div>
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">{view.purpose}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={buildResearchDraft} disabled={building}><Search />{building ? "Building…" : RESEARCH_ROOM_PRIMARY_CTA}</Button>
            <Button variant="secondary" onClick={buildResearchDraft}><RefreshCw />{RESEARCH_ROOM_REGENERATE_CTA}</Button>
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
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              ref={packRef}
              type="file"
              accept=".txt,.md,.fountain,text/plain,text/markdown"
              multiple
              className="sr-only"
              onChange={(event) => {
                const files = event.currentTarget.files;
                if (!files?.length) return;
                void Promise.all([...files].map(async (file) => {
                  const text = await file.text();
                  addSource({
                    title: file.name,
                    locator: file.name,
                    quote: text.slice(0, 800),
                    confidence: "C",
                    importedFrom: file.name,
                  });
                })).then(() => toast.success("Source material added."));
                event.currentTarget.value = "";
              }}
            />
            <Button variant="ghost" size="sm" onClick={addSourceMaterial}><FolderPlus />{RESEARCH_SOURCE_MATERIAL_CTA}</Button>
            <Button variant="ghost" size="sm" onClick={openManualNotes}>{RESEARCH_MANUAL_SUMMARY}</Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {view.showOffline ? (
            <div className="mb-5 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]" data-research-offline-panel="true">
              <p className="font-display text-lg tracking-tight">{view.offlineTitle}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{view.offlineBody}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={onRescan}><RefreshCw />Rescan</Button>
                <Button size="sm" variant="ghost" onClick={addSourceMaterial}>{RESEARCH_SOURCE_MATERIAL_CTA}</Button>
                <Button size="sm" variant="ghost" onClick={openManualNotes}>{RESEARCH_MANUAL_SUMMARY}</Button>
                <Button size="sm" variant="ghost" onClick={() => returnToDefaultMode()}>Return to Default Mode</Button>
              </div>
            </div>
          ) : null}

          {pasteOpen ? (
            <form
              className="mb-5 grid max-w-3xl gap-2 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
              onSubmit={(event) => {
                event.preventDefault();
                addSource({
                  title: pasteTitle.trim() || "Pasted source",
                  locator: "pasted-source-text",
                  quote: pasteText,
                  confidence: "C",
                  importedFrom: null,
                });
                setPasteTitle("");
                setPasteText("");
                setPasteOpen(false);
                toast.success("Source material added.");
              }}
            >
              <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Source material</p>
              <Input value={pasteTitle} onChange={(event) => setPasteTitle(event.target.value)} placeholder="Title" />
              <Textarea className="min-h-32" value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="Source text" required />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm">Add source material</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPasteOpen(false)}>Cancel</Button>
              </div>
            </form>
          ) : null}

          {view.showEmptyState && section === "overview" ? (
            <div className="max-w-3xl rounded-lg bg-elevated p-5 shadow-[var(--shadow-border)]" data-research-empty-state="true">
              <p className="font-display text-xl tracking-tight">No Research Bible has been generated yet.</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">Build Research Draft to draft:</p>
              <ul className="mt-3 grid gap-1 text-sm text-muted">
                {RESEARCH_EMPTY_SECTIONS.map((item) => <li key={item}>· {item}</li>)}
              </ul>
              <Button className="mt-5" onClick={buildResearchDraft}><Search />{RESEARCH_ROOM_PRIMARY_CTA}</Button>
            </div>
          ) : null}

          {!view.showEmptyState && section === "overview" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <SectionCard title="Source / Canon Ledger" body={`${draft.sources.length} source(s)`} onOpen={() => setSection("sources")} />
              <SectionCard title="World Overview" body={draft.socialWorldNotes.length ? `${draft.socialWorldNotes.length} social notes` : (draft.notes.trim() || "No world notes yet")} onOpen={() => setSection("social")} />
              <SectionCard title="Characters" body={characters.length ? characters.map((item) => item.name).join(", ") : "Not in Research Bible yet"} />
              <SectionCard title="Locations" body={locations.length ? locations.map((item) => item.name).join(", ") : "Not in Research Bible yet"} />
              <SectionCard title="Visual Identity" body={draft.cinematographyManifesto.texture || draft.cinematographyManifesto.thesis || "Not generated"} onOpen={() => setSection("camera")} />
              <SectionCard title="Cinematography" body={draft.cinematographyManifesto.lensLanguage || draft.cinematographyManifesto.thesis || "Not generated"} onOpen={() => setSection("camera")} />
              <SectionCard title="Risks" body={draft.risks.trim() || "No risks recorded"} onOpen={() => setSection("risks")} />
            </div>
          ) : null}

          {section === "sources" ? <SourceLedgerPanel content={draft} /> : null}
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

          <details ref={manualRef} id="manual-source-entry" data-manual-source-entry="true" className="mt-6 max-w-3xl rounded-lg bg-inset p-4">
            <summary className="cursor-pointer text-sm text-muted">{RESEARCH_MANUAL_SUMMARY}</summary>
            <div className="mt-4 grid gap-4">
              <AddSourceForm onAdd={addSource} />
              <Button size="sm" variant="secondary" onClick={() => setPasteOpen(true)}>Paste source text</Button>
              <div>
                <Label>Research notes</Label>
                <Textarea className="mt-1.5 min-h-24" value={draft.notes} onChange={(event) => persistContent({ ...draft, notes: event.target.value })} />
              </div>
            </div>
          </details>
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

      <aside className="hidden min-h-0 overflow-y-auto border-l border-border p-4 lg:block" data-research-status-panel="true">
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Research status</p>
        <p className="mt-2 text-sm">{view.statusLabel}</p>
        <div className="my-5 border-t border-border" />
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Model status</p>
        <p className="mt-2 text-sm">{view.modelStatusLabel}</p>
        <div className="my-5 border-t border-border" />
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Actions</p>
        <div className="mt-3 grid gap-2">
          <Button size="sm" variant="secondary" onClick={onRescan}><RefreshCw />Rescan</Button>
          <Button size="sm" variant="secondary" onClick={buildResearchDraft}><RefreshCw />{RESEARCH_ROOM_REGENERATE_CTA}</Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!bible.approvedVersionId}
            onClick={() => {
              onChange(startDeltaResearch(bible, draft, uid("rsv")));
              toast.message("Delta Research opened. Approved notes remain.");
            }}
          >
            <GitBranch />Delta Research
          </Button>
        </div>
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

function SectionCard({ title, body, onOpen }: { title: string; body: string; onOpen?: () => void }) {
  const inner = (
    <>
      <h3 className="font-display text-lg tracking-tight">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted">{body}</p>
    </>
  );
  if (!onOpen) return <article className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">{inner}</article>;
  return (
    <button type="button" className="rounded-lg bg-elevated p-4 text-left shadow-[var(--shadow-border)] hover:shadow-[var(--shadow-border-hover)]" onClick={onOpen}>
      {inner}
    </button>
  );
}
