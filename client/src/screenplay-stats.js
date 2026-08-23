export function sectionNames(markdown, start, end) {
  const source = String(markdown || "");
  const from = source.search(new RegExp(start, "i"));
  if (from < 0) return [];
  const remainder = source.slice(from);
  const to = remainder.search(new RegExp(end, "i"));
  const section = to > 0 ? remainder.slice(0, to) : remainder;
  return [...section.matchAll(/^###\s+(.+)$/gm)].map((match) => match[1].replace(/\s+-\s+.+$/, "").trim());
}

export function screenplayStats(markdown) {
  const text = String(markdown || "");
  const title = text.match(/^#\s+(.+)$/m)?.[1] || "Untitled screenplay";
  const runtime = text.match(/\*\*Runtime[^:]*:\*\*\s*([^\n]+)/i)?.[1]?.trim()
    || text.match(/TARGET\s+RUNTIME:\s*([^\n]+)/i)?.[1]?.trim()
    || text.match(/\b(\d+)\s*-\s*Minute\b/i)?.[0]
    || "—";
  const scenes = (text.match(/^\s*(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)[^\n]+$/gm) || []).length;
  const studioDialogue = (text.match(/^\s{12,}[A-Z][A-Z .'-]{2,}$/gm) || []).length;
  const leftDialogue = (text.match(/^[A-Z][A-Z0-9 .'-]{2,40}(?:\s*\(.*\))?$/gm) || [])
    .filter((line) => !/^(INT\.|EXT\.|FADE|CUT|BACK|INTERCUT|SAME|CONTINUOUS|TITLE)/.test(line)).length;
  const dialogue = Math.max(studioDialogue, leftDialogue);
  const characters = sectionNames(text, "## 1\\. CHARACTER ASSETS", "## 2\\. LOCATION ASSETS");
  const locations = sectionNames(text, "## 2\\. LOCATION ASSETS", "## 3\\. ARTIFACT ASSETS");
  const artifacts = sectionNames(text, "## 3\\. ARTIFACT ASSETS", "## 4\\. ATMOSPHERIC ASSETS");
  return { title, runtime, scenes, dialogue, characters, locations, artifacts, words: text.trim() ? text.trim().split(/\s+/).length : 0 };
}
