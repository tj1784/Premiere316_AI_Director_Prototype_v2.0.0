import type { ScreenplayNode } from "./screenplay-hierarchy.ts";

/** Manual editing preserves every code unit outside the displayed scene span. */
export function replaceScreenplayEditorScene(
  source: string,
  scene: Pick<ScreenplayNode, "sourceStart" | "sourceEnd">,
  replacement: string,
): string {
  if (
    !Number.isInteger(scene.sourceStart) ||
    !Number.isInteger(scene.sourceEnd) ||
    scene.sourceStart < 0 ||
    scene.sourceEnd < scene.sourceStart ||
    scene.sourceEnd > source.length
  )
    throw new Error("The selected scene changed. Reopen it before editing.");
  const original = source.slice(scene.sourceStart, scene.sourceEnd);
  const normalized = original.replace(/\r\n?/g, "\n");
  const next = replacement.replace(/\r\n?/g, "\n");
  let prefix = 0;
  while (prefix < normalized.length && prefix < next.length && normalized[prefix] === next[prefix])
    prefix += 1;
  if (prefix === normalized.length && prefix === next.length) return source;
  let suffix = 0;
  while (
    suffix < normalized.length - prefix &&
    suffix < next.length - prefix &&
    normalized[normalized.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix += 1;
  const start = scene.sourceStart + textareaOffsetToSource(original, prefix);
  const end = scene.sourceStart + textareaOffsetToSource(original, normalized.length - suffix);
  const newline = original.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const inserted = next.slice(prefix, next.length - suffix).replaceAll("\n", newline);
  return source.slice(0, start) + inserted + source.slice(end);
}

/** Textarea selection offsets are based on LF-normalized text, even for imported CRLF files. */
export function textareaOffsetToSource(text: string, offset: number): number {
  let normalized = 0;
  let source = 0;
  while (source < text.length && normalized < offset) {
    if (text[source] === "\r" && text[source + 1] === "\n") source += 2;
    else source += 1;
    normalized += 1;
  }
  return source;
}
