/** Reject serialization leaked into prose; the writer must regenerate, never silently repair it. */
export function assetPromptText(row: Record<string, unknown>): string {
  const assertVisualProse = (text: string) => {
    const normalized = text.normalize("NFKC").replace(/[\u2010-\u2015-]/g, " ");
    if (/\b(?:this|final|resulting|generated)\s+(?:image\s+)?prompt\b|\bsource\s+quote\s*:|\b(?:token limits?|weighted tags|sampler settings|fluid dynamics simulations?|shaders?|particle systems?)\b/i.test(normalized)) {
      throw new Error("Image prompt contains writing instructions, citations or implementation notes. Describe only the visible image; do not describe the prompt or how to produce it.");
    }
  };
  if (row.promptParagraphs !== undefined) {
    if (!Array.isArray(row.promptParagraphs) || row.promptParagraphs.length !== 10 || row.promptParagraphs.some((paragraph) => typeof paragraph !== "string")) throw new Error("Return exactly ten natural-language prompt paragraphs.");
    for (const paragraph of row.promptParagraphs as string[]) {
      assertVisualProse(paragraph);
      if (/```|["'](?:assetId|promptParagraphs|sourceQuote|cinematographyManifestoReference)["']\s*:|"\s*[\]}]\s*[,}\]]|\\n\s*\\"/.test(paragraph)) {
        throw new Error("Prompt paragraphs contain embedded JSON, code fences or escaped serialization instead of visual prose.");
      }
    }
    return (row.promptParagraphs as string[]).join("\n\n").trim();
  }
  // Previously saved writer responses can use the original single-prompt contract.
  const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
  assertVisualProse(prompt);
  return prompt;
}
