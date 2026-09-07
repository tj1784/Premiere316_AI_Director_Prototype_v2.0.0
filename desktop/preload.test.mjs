import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const preload = readFileSync(join(root, "desktop", "preload.cjs"), "utf8");
const authorityReviewPreload = readFileSync(join(root, "desktop", "authority-review-preload.cjs"), "utf8");
const authorityReviewHtml = readFileSync(join(root, "desktop", "authority-review.html"), "utf8");
const confirmationPreload = readFileSync(join(root, "desktop", "confirmation-preload.cjs"), "utf8");
const confirmationHtml = readFileSync(join(root, "desktop", "confirmation.html"), "utf8");
const main = readFileSync(join(root, "desktop", "main.mjs"), "utf8");
const backend = readFileSync(join(root, "desktop", "backend.mjs"), "utf8");
const builder = readFileSync(join(root, "electron-builder.yml"), "utf8");
const lock = readFileSync(join(root, "DESKTOP.md"), "utf8");

describe("desktop security boundary", () => {
  it("preload does not expose fs, spawn, or a generic path API", () => {
    assert.match(preload, /contextBridge\.exposeInMainWorld/);
    assert.doesNotMatch(preload, /require\(["']fs["']\)/);
    assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*fs/);
    assert.doesNotMatch(preload, /readFileSync/);
    assert.doesNotMatch(preload, /spawn\(/);
  });
  it("sandboxed preload does not require local modules", () => {
    assert.doesNotMatch(preload, /require\(["']\.\/channels/);
    assert.match(preload, /p316:catalog:get/);
  });
  it("renderer never receives a generic models filesystem API", () => {
    assert.doesNotMatch(preload, /modelsRootWrite/);
    assert.doesNotMatch(preload, /readdir/);
    assert.doesNotMatch(preload, /unlink/);
    assert.doesNotMatch(preload, /D:\\\\AI\\\\Models/);
  });
  it("Electron window is sandboxed without nodeIntegration", () => {
    assert.match(main, /nodeIntegration:\s*false/);
    assert.match(main, /contextIsolation:\s*true/);
    assert.match(main, /sandbox:\s*true/);
    assert.match(main, /webviewTag:\s*false/);
    assert.match(main, /frame:\s*true/);
    assert.match(main, /minimizable:\s*true/);
  });
  it("production does not open an external browser for the product", () => {
    assert.match(main, /isPackaged\(\)/);
    assert.match(main, /return \{ action: "deny" \}/);
    assert.doesNotMatch(main, /shell\.openExternal\(uiOrigin/);
  });
  it("backend owns model scan and prepared-image authorization without free generation routes", () => {
    assert.match(backend, /loadCatalog/);
    assert.match(backend, /exposeLocalStill/);
    assert.match(backend, /stopLocalEngine/);
    assert.match(backend, /ALLOWED/);
    assert.match(backend, /sanitizeCatalog/);
    assert.match(backend, /image\.proposePrepared/);
    assert.match(backend, /image\.confirmPrepared/);
    assert.match(main, /Confirm prepared image generation/);
    assert.match(main, /image\.confirmCanonicalApproval/);
    assert.match(backend, /pendingPrepared\.delete\(token\)/);
    assert.match(backend, /stableManifestDigest/);
    assert.match(backend, /expectedPreparedFingerprints/);
    assert.match(backend, /appendLedger\("preparedSeal"/);
    assert.match(backend, /appendLedger\("generationReceipt"/);
    assert.doesNotMatch(preload, /image\.proposePrepared|image\.confirmPrepared|confirmCanonicalApproval/);
    assert.doesNotMatch(backend, /sameFingerprints\(prepared\.dependencyFingerprints, prepared\.dependencyFingerprints\)/);
    assert.doesNotMatch(preload, /stillsExpose|stillsWake|enginesBenchmark|benchmark:|enginesInspect|inspect:/);
    assert.doesNotMatch(backend, /"stills\.expose"|"stills\.wake"|"engines\.benchmark"|"engines\.inspect"/);
  });
  it("IPC is origin-checked and credentials use safeStorage", () => {
    assert.match(main, /assertTrustedSender/);
    assert.match(main, /Rejected IPC from an untrusted renderer/);
    assert.match(main, /safeStorage/);
    assert.match(main, /showSaveDialog/);
    assert.match(main, /taskkill/);
    assert.match(preload, /p316:app:systemStatus/);
    assert.match(preload, /p316:app:buildInfo/);
    assert.match(main, /rendererMode: isPackaged\(\) \? "PACKAGED DIST" : "DEV SERVER"/);
    assert.match(main, /nvidia-smi/);
    assert.match(preload, /p316:zoom:get/);
    assert.match(preload, /p316:zoom:set/);
    assert.match(main, /setZoomFactor/);
    assert.match(main, /before-input-event/);
  });
  it("Windows executable is Premiere316.exe with an icon and installer", () => {
    assert.match(builder, /executableName:\s*Premiere316/);
    assert.match(builder, /productName:\s*Premiere316/);
    assert.match(builder, /createDesktopShortcut:\s*true/);
    assert.match(builder, /icon:\s*desktop\/icon\.ico/);
    assert.equal(existsSync(join(root, "desktop", "icon.ico")), true);
  });
  it("packages every local Electron runtime dependency and audits the output", () => {
    assert.match(builder, /desktop\/workers\/flux1_jsonl_worker\.py/);
    for (const file of ["main.mjs", "ffmpeg-tool.mjs", "preload.cjs", "authority-review-preload.cjs", "authority-review.html", "confirmation-preload.cjs", "confirmation.html", "channels.cjs", "zoom.cjs"]) {
      assert.equal(existsSync(join(root, "desktop", file)), true);
      assert.equal(builder.includes(`desktop/${file}`), true);
    }
    assert.match(main, /require\("\.\/channels\.cjs"\)/);
    assert.match(main, /require\("\.\/zoom\.cjs"\)/);
    assert.match(main, /AUTHORITY_REVIEW_PRELOAD/);
    assert.match(authorityReviewHtml, /Content-Security-Policy/);
    assert.match(authorityReviewHtml, /Untrusted project proposal normalized by the backend/);
    assert.match(authorityReviewPreload, /p316:authorityReview:get/);
    assert.match(authorityReviewHtml, /Seal exactly reviewed authority/);
    const pack = readFileSync(join(root, "desktop", "pack.mjs"), "utf8");
    assert.match(pack, /packaged runtime audit passed/);
    assert.match(pack, /\/desktop\/zoom\.cjs/);
    assert.match(pack, /\/desktop\/confirmation-preload\.cjs/);
    assert.match(pack, /\/desktop\/confirmation\.html/);
    assert.match(pack, /ui", "server", "index\.mjs/);
  });
  it("authority review modal is isolated, nonce-bound, and not auto-confirmed", () => {
    assert.match(main, /function showAuthorityReviewModal\(reviewDocument\)/);
    assert.match(main, /randomBytes\(24\)\.toString\("hex"\)/);
    assert.match(main, /assertAuthorityReviewSender/);
    assert.match(main, /event\.sender !== state\.webContents/);
    assert.match(main, /nodeIntegration:\s*false/);
    assert.match(main, /contextIsolation:\s*true/);
    assert.match(main, /sandbox:\s*true/);
    assert.match(main, /webSecurity:\s*true/);
    assert.match(main, /partition:\s*modalPartition/);
    assert.match(main, /`authority-review-\$\{nonce\}`/);
    assert.doesNotMatch(main, /persist:authority-review/);
    assert.match(main, /modalSession === session\.defaultSession/);
    assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
    assert.match(main, /modalSession\.webRequest\.onBeforeRequest[\s\S]*cancel:\s*true/);
    assert.doesNotMatch(main, /modal\.webContents\.session\.webRequest\.onBeforeRequest/);
    assert.match(main, /modal\.once\("closed", \(\) => cleanup\(false\)\)/);
    assert.match(authorityReviewPreload, /event\.key === "Escape"/);
    assert.match(authorityReviewPreload, /document\.addEventListener\("keydown", trapFocus\)/);
    assert.match(authorityReviewPreload, /cancel\.focus\(\)/);
    assert.doesNotMatch(preload, /p316:authorityReview:get|p316:authorityReview:resolve/);
  });

  it("canonical rejection is native-confirmed and not a direct backend append", () => {
    assert.match(main, /image\.proposeCanonicalRejection/);
    assert.match(main, /Confirm Canonical Rejection/);
    assert.match(main, /image\.confirmCanonicalRejection/);
    assert.doesNotMatch(main, /callBackend\("image\.rejectCanonical"/);
  });

  it("small privileged confirmations use nonce-bound main-owned modal windows", () => {
    assert.match(main, /function showMainOwnedConfirmation/);
    assert.match(main, /const modalPartition = `confirmation-\$\{nonce\}`/);
    assert.match(main, /assertConfirmationSender/);
    assert.match(main, /event\.sender !== state\.webContents/);
    assert.match(main, /p316:confirmation:get/);
    assert.match(main, /p316:confirmation:resolve/);
    assert.match(main, /CONFIRMATION_PRELOAD/);
    assert.match(main, /CONFIRMATION_HTML/);
    assert.match(main, /Confirm Prepared Approval/);
    assert.match(main, /Confirm Generate/);
    assert.match(main, /Confirm Canonical Rejection/);
    assert.match(main, /Confirm Canonical Approval/);
    assert.doesNotMatch(main, /Confirm Prepared Approval[\s\S]{0,120}showMessageBox/);
    assert.doesNotMatch(main, /Confirm Generate[\s\S]{0,120}showMessageBox/);
    assert.doesNotMatch(main, /Confirm Canonical Rejection[\s\S]{0,120}showMessageBox/);
    assert.doesNotMatch(main, /Confirm Canonical Approval[\s\S]{0,120}showMessageBox/);
    assert.doesNotMatch(preload, /p316:confirmation:get|p316:confirmation:resolve/);
    assert.match(confirmationPreload, /p316:confirmation:get/);
    assert.match(confirmationPreload, /p316:confirmation:resolve/);
    assert.match(confirmationPreload, /Escape/);
    assert.match(confirmationHtml, /Content-Security-Policy/);
    assert.match(confirmationHtml, /connect-src 'none'/);
    assert.match(confirmationHtml, /min-width:390px/);
    assert.match(confirmationHtml, /aria-label="Frozen backend summary"/);
  });

  it("desktop application override is locked", () => {
    assert.match(lock, /standalone Windows desktop application/);
    assert.match(lock, /Premiere316\.exe/);
    assert.match(lock, /contextIsolation: true/);
  });
});
