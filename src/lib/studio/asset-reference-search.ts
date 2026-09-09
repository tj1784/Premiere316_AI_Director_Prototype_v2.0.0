/** Model-led retries preserve already attached references and never choose rejected images. */
export async function researchAssetReference<T>(initialQuery: string, hooks: {
  search: (query: string) => Promise<T[]>;
  choose: (query: string, candidates: T[]) => Promise<{ index: number; reason: string }>;
  refine: (query: string, feedback: string) => Promise<string>;
  progress: (message: string) => void;
}): Promise<T> {
  let query = initialQuery;
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    hooks.progress(`Searching visual references (${attempt + 1}/3): ${query}`);
    try {
      const candidates = await hooks.search(query);
      if (candidates.length) {
        const choice = await hooks.choose(query, candidates);
        if (Number.isInteger(choice.index) && choice.index >= 0 && choice.index < candidates.length) return candidates[choice.index];
        feedback = choice.reason || "The model rejected every candidate.";
      } else feedback = "No usable public image candidates were found.";
    } catch (error) {
      feedback = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 2) {
      query = (await hooks.refine(query, feedback)).trim();
      if (!query || query.length > 300) throw new Error("The model returned an invalid revised reference search.");
    }
  }
  throw new Error(`Reference search exhausted for ${initialQuery}: ${feedback}`);
}
