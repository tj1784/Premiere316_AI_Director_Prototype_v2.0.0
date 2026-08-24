import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  TOP_LEVEL_ROUTES,
  resolveProductionRoute,
  routeForShorts,
  routeSection,
  routeSubtab
} from "../client/src/navigation.js";

test("legacy production routes redirect to their integrated workspaces", () => {
  assert.equal(resolveProductionRoute("/media"), "/direct/sequence");
  assert.equal(resolveProductionRoute("/ltx-director"), "/direct/ltx");
  assert.equal(resolveProductionRoute("/comfyui"), "/direct/comfyui");
  assert.equal(resolveProductionRoute("/comfy"), "/direct/comfyui");
});

test("workspace roots use a valid remembered subtab", () => {
  assert.equal(resolveProductionRoute("/assets", { assetsTab: "library" }), "/assets/library");
  assert.equal(resolveProductionRoute("/assets", { assetsTab: "characters" }), "/assets/characters");
  assert.equal(resolveProductionRoute("/direct", { directTab: "ltx" }), "/direct/ltx");
  assert.equal(resolveProductionRoute("/assets", { assetsTab: "invalid" }), "/assets/prompts");
});

test("route helpers preserve the locked production taxonomy", () => {
  assert.equal(routeSection("/assets/ost"), "assets");
  assert.equal(routeSubtab("/assets/ost"), "ost");
  assert.equal(routeForShorts("/screenplay"), "/direct/sequence");
  assert.equal(resolveProductionRoute("/unknown"), "/edit");
  assert.equal(resolveProductionRoute("/upscale"), "/upscale");
  assert.equal(routeSection("/upscale"), "upscale");
  assert.equal(TOP_LEVEL_ROUTES.upscale, "/upscale");
  const app = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../client/src/App.tsx"), "utf8");
  assert.match(app, /navButton\("upscale", "Upscale Plan", "\/upscale"/);
  assert.match(app, /if \(route === "\/upscale"\) return <UpscaleWorkspace/);
});

test("Create Sound is a stable top-level production route", () => {
  assert.equal(resolveProductionRoute("/sound"), "/sound");
  assert.equal(resolveProductionRoute("/sound/"), "/sound");
  assert.equal(routeSection("/sound"), "sound");
  assert.equal(routeSubtab("/sound"), null);
});
