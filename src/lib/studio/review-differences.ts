export type ReviewDifference = { path: string; before: unknown; after: unknown };
/** Compare structured candidate values without treating object-key order as a revision. */
export function reviewDifferences(
  before: unknown,
  after: unknown,
  path = "Draft",
): ReviewDifference[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after))
    return Array.from({ length: Math.max(before.length, after.length) }, (_, i) =>
      reviewDifferences(before[i], after[i], `${path} [${i + 1}]`),
    ).flat();
  if (
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const left = before as Record<string, unknown>,
      right = after as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap((key) =>
      reviewDifferences(
        left[key],
        right[key],
        `${path} / ${key.replace(/([a-z])([A-Z])/g, "$1 $2")}`,
      ),
    );
  }
  return [{ path, before, after }];
}
