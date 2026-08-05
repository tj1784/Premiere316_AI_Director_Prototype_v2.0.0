export const BOOKEND_DURATION_SEC = 30;
export const BOOKEND_OPENING_TITLE = "Premiere316 Productions";

const MAX_CREDIT_CHARACTERS = 4000;
const MAX_CREDIT_LINES = 60;
const MAX_CREDIT_LINE_CHARACTERS = 160;

export function defaultCreditsText(projectName = "Untitled Project") {
  const title = String(projectName || "Untitled Project").trim() || "Untitled Project";
  return `${title.toUpperCase()}\n\nA Premiere316 Production\n\nCreated with Premiere316 AI Director`;
}

export function sanitizeCreditsText(value, projectName = "Untitled Project") {
  const fallback = defaultCreditsText(projectName);
  const source = value == null ? fallback : String(value);
  const cleaned = source
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .slice(0, MAX_CREDIT_LINES)
    .map((line) => line.slice(0, MAX_CREDIT_LINE_CHARACTERS).replace(/[\t ]+$/g, ""))
    .join("\n")
    .slice(0, MAX_CREDIT_CHARACTERS)
    .trim();
  return cleaned || fallback;
}

export function normalizeBookends(value, projectName = "Untitled Project") {
  const source = value && typeof value === "object" ? value : {};
  const opening = source.opening && typeof source.opening === "object" ? source.opening : {};
  const credits = source.credits && typeof source.credits === "object" ? source.credits : {};
  return {
    opening: {
      enabled: opening.enabled === true,
      durationSec: BOOKEND_DURATION_SEC,
      title: BOOKEND_OPENING_TITLE
    },
    credits: {
      enabled: credits.enabled === true,
      durationSec: BOOKEND_DURATION_SEC,
      text: sanitizeCreditsText(credits.text, projectName)
    }
  };
}

export function bookendDurationSec(value, projectName = "Untitled Project") {
  const bookends = normalizeBookends(value, projectName);
  return (bookends.opening.enabled ? BOOKEND_DURATION_SEC : 0) +
    (bookends.credits.enabled ? BOOKEND_DURATION_SEC : 0);
}
