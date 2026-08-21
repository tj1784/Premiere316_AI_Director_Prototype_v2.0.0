import assert from "node:assert/strict";
import test from "node:test";
import { comfyControlLabel, comfyControlTitle } from "../client/src/comfy-control.js";

test("ComfyUI header control is a start/restart state toggle", () => {
  assert.equal(comfyControlLabel({ online: false }), "▶ START COMFYUI");
  assert.equal(comfyControlLabel({ online: true }), "↻ RESTART COMFYUI");
  assert.equal(comfyControlLabel({ online: false, busy: true, status: "starting" }), "STARTING COMFYUI…");
  assert.equal(comfyControlLabel({ online: true, busy: true, status: "restarting" }), "RESTARTING COMFYUI…");
});

test("ComfyUI header control explains managed, busy, and external states", () => {
  assert.match(comfyControlTitle({ online: false, managed: true, endpoint: "127.0.0.1:8188" }), /Start the local ComfyUI/);
  assert.match(comfyControlTitle({ online: true, managed: true, endpoint: "127.0.0.1:8188" }), /restart the local ComfyUI/);
  assert.match(comfyControlTitle({ online: true, managed: true, queueUnsafe: true }), /Finish or stop/);
  assert.match(comfyControlTitle({ online: false, managed: false }), /Settings/);
});
