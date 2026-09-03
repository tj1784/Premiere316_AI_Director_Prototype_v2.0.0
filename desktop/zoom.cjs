"use strict";

const ZOOM_STEPS = Object.freeze([1, 1.1, 1.25, 1.33, 1.5, 1.75, 2]);
const DEFAULT_ZOOM = 1;

function normalizeZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ZOOM;
  return ZOOM_STEPS.reduce((best, step) =>
    Math.abs(step - numeric) < Math.abs(best - numeric) ? step : best,
  DEFAULT_ZOOM);
}

function stepZoom(current, direction) {
  const normalized = normalizeZoom(current);
  const index = ZOOM_STEPS.indexOf(normalized);
  if (direction > 0) return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, index + 1)];
  if (direction < 0) return ZOOM_STEPS[Math.max(0, index - 1)];
  return DEFAULT_ZOOM;
}

function zoomCommandFromInput(input) {
  if (!input?.control || input.alt || input.meta) return null;
  const key = String(input.key || "");
  const code = String(input.code || "");
  if (key === "+" || key === "=" || code === "Equal" || code === "NumpadAdd") return "in";
  if (key === "-" || code === "Minus" || code === "NumpadSubtract") return "out";
  if (key === "0" || code === "Digit0" || code === "Numpad0") return "reset";
  return null;
}

function parseZoomPreferences(text) {
  try {
    const prefs = JSON.parse(String(text));
    return normalizeZoom(prefs?.zoom);
  } catch {
    return DEFAULT_ZOOM;
  }
}

function serializeZoomPreferences(factor) {
  return `${JSON.stringify({ version: 1, zoom: normalizeZoom(factor) })}\n`;
}

module.exports = {
  ZOOM_STEPS,
  DEFAULT_ZOOM,
  normalizeZoom,
  stepZoom,
  zoomCommandFromInput,
  parseZoomPreferences,
  serializeZoomPreferences,
};
