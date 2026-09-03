import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ZOOM_STEPS, normalizeZoom, parseZoomPreferences, serializeZoomPreferences, stepZoom, zoomCommandFromInput } = require("./zoom.cjs");

describe("desktop interface zoom", () => {
  it("uses bounded standard steps from 50% through 200%", () => {
    assert.deepEqual(ZOOM_STEPS, [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.33, 1.5, 1.75, 2]);
    assert.equal(stepZoom(0.5, -1), 0.5);
    assert.equal(stepZoom(2, 1), 2);
    assert.equal(stepZoom(1, 1), 1.1);
    assert.equal(stepZoom(1, -1), 0.9);
  });

  it("normalizes restored or renderer-provided values", () => {
    assert.equal(normalizeZoom(undefined), 1);
    assert.equal(normalizeZoom(0.74), 0.75);
    assert.equal(normalizeZoom(9), 2);
    assert.equal(normalizeZoom(-1), 0.5);
  });

  it("round-trips the persisted interface preference and safely resets bad data", () => {
    assert.equal(parseZoomPreferences(serializeZoomPreferences(1.25)), 1.25);
    assert.equal(parseZoomPreferences('{"version":1,"zoom":0.79}'), 0.8);
    assert.equal(parseZoomPreferences("not-json"), 1);
  });

  it("recognizes plus, equals, minus, reset, and numpad equivalents", () => {
    assert.equal(zoomCommandFromInput({ control: true, key: "+", code: "Equal" }), "in");
    assert.equal(zoomCommandFromInput({ control: true, key: "=", code: "Equal" }), "in");
    assert.equal(zoomCommandFromInput({ control: true, key: "Add", code: "NumpadAdd" }), "in");
    assert.equal(zoomCommandFromInput({ control: true, key: "-", code: "Minus" }), "out");
    assert.equal(zoomCommandFromInput({ control: true, key: "Subtract", code: "NumpadSubtract" }), "out");
    assert.equal(zoomCommandFromInput({ control: true, key: "0", code: "Digit0" }), "reset");
    assert.equal(zoomCommandFromInput({ control: true, key: "Insert", code: "Numpad0" }), "reset");
  });

  it("does not intercept unrelated editing shortcuts or modified keys", () => {
    for (const key of ["c", "v", "x", "a", "z", "y"]) {
      assert.equal(zoomCommandFromInput({ control: true, key, code: `Key${key.toUpperCase()}` }), null);
    }
    assert.equal(zoomCommandFromInput({ control: true, alt: true, key: "+", code: "Equal" }), null);
    assert.equal(zoomCommandFromInput({ control: false, key: "+", code: "Equal" }), null);
  });
});
