import { RESEARCH_CONFIDENCE_LEGEND } from "@/lib/research/confidence.ts";
import type { PictureResearchBible } from "@/lib/research/bible.ts";

const SECTIONS = [
  { id: "sources", label: "Sources" },
  { id: "social", label: "Social world" },
  { id: "camera", label: "Cinematography" },
  { id: "risks", label: "Risks" },
] as const;

export function BibleNav({ bible, active, onSelect }: { bible: PictureResearchBible; active: string; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Research Bible" className="grid gap-1">
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          className={`rounded-sm px-2 py-2 text-left text-xs ${active === section.id ? "bg-elevated text-fg" : "text-muted hover:bg-elevated hover:text-fg"}`}
          aria-current={active === section.id ? "true" : undefined}
          onClick={() => onSelect(section.id)}
        >
          {section.label}
        </button>
      ))}
      <p className="mt-4 text-[10px] tracking-[0.2em] text-subtle uppercase">Confidence</p>
      <ul className="mt-2 grid gap-1 text-[11px] text-muted">
        {Object.entries(RESEARCH_CONFIDENCE_LEGEND).map(([letter, label]) => (
          <li key={letter}><span className="text-subtle">{letter}</span> · {label}</li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] leading-relaxed text-muted">{bible.content.sources.length} sources · {bible.versions.length} versions</p>
    </nav>
  );
}
