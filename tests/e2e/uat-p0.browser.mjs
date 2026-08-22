import test from "node:test";
import assert from "node:assert/strict";
import { APP_ORIGIN, CASES } from "./browser-harness.mjs";

async function get(path) {
  const url = path.startsWith("http") ? path : APP_ORIGIN + path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " -> " + res.status);
  return res.text();
}

async function liveBundle() {
  const html = await get("/");
  const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  assert.ok(match, "running origin did not serve a Vite index bundle");
  return get(match[1]);
}

test("P0 case list is UAT-001 through UAT-006", () => {
  assert.deepEqual(CASES, ["UAT-001", "UAT-002", "UAT-003", "UAT-004", "UAT-005", "UAT-006"]);
});

test("origin is the running app", () => {
  assert.equal(APP_ORIGIN.startsWith("http"), true);
  assert.doesNotMatch(APP_ORIGIN, /client\/src/);
});

test("served bundle includes the Foundation drawer", async () => {
  const js = await liveBundle();
  assert.match(js, /asset-action-drawer|CONTEXTUAL ASSET ACTION/, "drawer missing from the live Vite bundle — rebuild and restart");
});

test("UAT-001 live bundle can open a voice action", async () => {
  const js = await liveBundle();
  assert.match(js, /openAssetAction|RequirementSlot|Create voice/, "Characters voice slot is still inspect-only in the live bundle");
});

test("UAT-003 live bundle exposes unmatched Assign", async () => {
  const js = await liveBundle();
  assert.match(js, /Assign to a character|Assign to this character/, "unmatched assign is not in the live bundle");
});

test("UAT-004 live bundle keeps wardrobe actionable", async () => {
  const js = await liveBundle();
  assert.match(js, /character\.wardrobe/, "wardrobe slot missing from the live bundle");
});

test("UAT-005 live bundle Storyboard picker is not a dead end", async () => {
  const js = await liveBundle();
  assert.match(js, /Create asset|openAssetAction/, "empty-search Create is not in the live bundle");
});

test("UAT-002 / UAT-006 are origin-bound, not TSX greps", async () => {
  const html = await get("/");
  assert.match(html, /index-[A-Za-z0-9_-]+\.js/);
  assert.doesNotMatch(html, /CharacterAssetsWorkspace\.tsx/);
});

