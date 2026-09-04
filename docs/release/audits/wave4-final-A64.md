# A64 Wave 4 replacement-candidate adversarial re-audit

- Candidate: `p316-20260904124249-f8c5609e32d4`
- Renderer/source hash: `f8c5609e32d4642132076347b74b7f07ed1495430a8d1fa6de0ee41e15a36999`
- Workflow: `544b1c84-b21f-4360-8a3b-f3719851037a`
- Child run: `a137d777-8c68-44bc-b291-f97e621df39e`
- Verdict: **PASS**

## Summary

Inherited decisions: the current Wave 4 replacement candidate is `p316-20260904124249-f8c5609e32d4`, renderer hash `f8c5609e32d4642132076347b74b7f07ed1495430a8d1fa6de0ee41e15a36999`. Only `docs/release/wave4-gate.md` and current `screenshots/wave4-native/` evidence are acceptance evidence; prior A07-vetoed artifacts are historical only. Wave 5 remains closed and no tag/checkpoint was authorized until A07/A08/A64 re-audits passed and A01 finalized.

Diagnosis: A64 re-attacked the replacement package boundary and evidence. The prior accessibility note is closed: authority-review preload implements Escape cancellation, focus containment, and initial Cancel focus; source matches packaged ASAR exactly. Main/backend—not renderer or local storage—own authority review, approvals, tokens, receipts, canonical/rejection decisions, media root, and ledger writes. Renderer-forged roots, proofs, decisions, and time-of-check/time-of-use attempts are constrained by main sender/origin checks, nonce-bound modal senders, main-overwritten media root, backend proposal revalidation, exact current authority/prepared-root/manifest/receipt binding, one-use tokens, and HMAC chained-ledger/tail validation.

Drift/contradiction check: no material contradiction was found in the current acceptance set. The previous daylight/reference-fixture veto is specifically remediated: current authority/provenance show `references: []`, the coastal asset references array is empty, and the continuity lock is the visibly checkable `visible exterior night sky`. The canonical image visibly satisfies a dark exterior-night scene with wet industrial/archive-like architecture and practical lights; the rejected image is also a real night image but was left unchecked and rejected with an image-specific reason. A minor non-blocking ordering quirk remains: `report.json` lists the warm image before the cold image in one generated/assertion list while gate prose uses cold/warm order; hashes, receipts, decisions, generation timestamps, and sidecars resolve identity unambiguously.

Recommendation: A64 passes. No executor handoff is warranted. Wave 5 remains closed until A01 creates the immutable checkpoint/tag.

## Blockers

- None.

## Findings

### INFO: Package, ASAR, source, and packaged-modal equality verified

Bounded Node hashing matched current candidate hashes: EXE `e0a37bbfb72b6c744fe5062a047d68c8dabd4d89ad5d846d2b8f7f14c8a0501c`, ASAR `ded6af1c2716bc7762b5f6b3ebd730c5564781bf90afa0746dfe72799f453c7c`, installer `e0b1206cfb3672dc7e5e86fba039b482e68510164a4ad4621d90bd80424ccdbd`, backend `6f2ea7...`, worker `8c37b8...`, and UI server `692a28...`. Recomputed renderer-source hash matched `f8c5609e32d4642132076347b74b7f07ed1495430a8d1fa6de0ee41e15a36999`. In-memory ASAR extraction byte-compared equal to source for `desktop/authority-review-preload.cjs`, `authority-review.html`, `confirmation-preload.cjs`, `main.mjs`, and `preload.cjs`.

### INFO: Prior authority-review accessibility note is closed

`desktop/authority-review-preload.cjs` now has `resolveOnce(false)` on Escape, traps focus over `input,button,[tabindex='0']`, registers `document.addEventListener("keydown", trapFocus)`, and calls `cancel.focus()`. `captures/06-authority-review-main-owned.png` visibly shows Cancel focused by default. Source and packaged ASAR authority preload are byte-equal.

### INFO: Main-owned modal isolation and sender/nonce binding hold

`desktop/main.mjs` creates random 24-byte nonces and unique nonpersistent partitions for authority and confirmation modals; uses `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`, `webviewTag:false`; denies window opens, HTTP/HTTPS/WS/WSS requests, permissions, and non-file navigation. IPC `p316:authorityReview:*` and `p316:confirmation:*` is accepted only when `event.sender` equals the stored modal `webContents` for that nonce. Primary `preload.cjs` exposes neither authority-review nor confirmation channels.

### INFO: Renderer-forged authority, roots, proofs, approvals, decisions, and TOCTOU attempts are materially blocked

`main.mjs` `assertTrustedSender` requires the UI origin and primary window; `withMediaRoot` overwrites a renderer-proposed root with `app.getPath('userData')/media`. `backend.mjs` requires current authority, backend-signed prepared-approval roots, exact prepared/asset/authority digest binding, stable manifest digest, exact receipt iteration/root/output verification, non-empty reasons, exact finding IDs, and rejects stale authorities, duplicate IDs, duplicate canonical approvals, reject-then-approve, replayed/canceled proposals, missing/used/expired tokens, and cross-root attempts.

### INFO: Fresh backend-ledger and security regression tests pass

The auditor ran bounded Node-only `node --test desktop/backend-ledger.test.mjs desktop/preload.test.mjs`; 23 tests passed and zero failed. Coverage includes ledger reorder/timestamp/tail tamper, duplicate canonical, cancel/replay, forged/cross-root/stale roots, authority-status scoping, absence of generic filesystem/spawn/model APIs, sandbox/no-nodeIntegration, nonce-bound modals, and native-confirmed canonical rejection.

### INFO: Current UAT no longer smuggles a reference/output and binds the visible lock truthfully

The current eight-record ledger contains authority `authority:51513fe...`, prepared root `preparedApproval:27cc...`, two seals, two receipts, rejection `rejection:cfae...`, and canonical decision `canonical:d34...`. Coastal-asset references are empty and continuity locks are `["visible exterior night sky"]`. Both sidecars contain `references: []`; no `reference.png`, data URL, or base64 fixture exists in current generated sidecars/report beyond empty-reference fields. The canonical decision binds `receipt:a6f18...` / warm PNG `4fe0d08...` with the finding confirmed; rejected `receipt:625a88...` / PNG `a13308...` has no confirmed finding.

### INFO: Generated PNGs are genuine, distinct, dark exterior-night outputs and match hashes

The auditor visually inspected both current PNGs. `a13308...` is a rain-wet dark urban exterior/street image and was rejected. `4fe0d08...` is a dark wet industrial/archive-like exterior with overhead/practical lights and visible night sky and was canonical. PNG and sidecar hashes match evidence: `a13308b4...` / sidecar `4661a63a...`, and `4fe0d08a...` / sidecar `4201bcb3...`. Both are 512×512, nontrivial, distinct, and reference-free.

### INFO: Offline/no-ComfyUI/no-cloud evidence is consistent

`report.json` network observations contain loopback UI assets, `media://` stills, and required `https://grok.com/grok-app-builder/extensions.js` only; there is no request to port 8188, no completion/inference POST, and no console/page error. Summary/validation evidence identifies worker PID 71148 for both jobs, identical worker/component digests, one worker after each generation, empty worker-TCP arrays, and zero worker processes after visible release and restart.

### INFO: Profile, external roots, components, processes, and cleanup evidence support preservation

`live-data-compare.json` reports the live Premiere316 profile byte-identical across 312 files with unchanged manifest `118052f7...`. Exact-component comparisons show all selected FLUX/AE/T5/CLIP/BPE/tokenizer/T5-snapshot hashes identical. Protected external-root counts/bytes are identical. All six LM Studio processes and operator-owned ComfyUI PID 37076 survived with identical command lines; no Premiere316/worker process remained. Isolated-profile cleanup reports zero remaining profiles.

### LOW: Non-blocking evidence-order quirk in report telemetry labeling

`report.json` lists warm/canonical `4fe0d08...` before cold/rejected `a13308...` in one generated/assertion array despite a cold/warm label. Gate summary, generation timestamps, sidecars, and per-image telemetry correctly identify `a13308...` as cold (`modelLoadMs` 126,630) and `4fe0d08...` as warm (`modelLoadMs` 0). This is not material because receipt/output hashes and signed decisions are unambiguous.

## Checks

- Treated `docs/release/wave4-gate.md` and current `screenshots/wave4-native/` as authoritative; historical veto artifacts were not acceptance evidence.
- Read current UAT/summary/validation, package hashes, generated ledger/tail, live-data/external/process/cleanup evidence, packaged smoke, and stage-visual report.
- Visually inspected current generated PNGs and authority-review, two-iteration review, rejection, canonical approval, restart-ledger, and confirmation-window captures.
- Hashed current package and generated PNG/sidecar artifacts with Node-only scripts; all matched.
- Recomputed renderer source hash using the pack algorithm; it matched current build identity.
- Extracted source files from ASAR in memory and byte-compared critical Electron modal/main/preload files; all matched.
- Inspected main, backend, preloads/HTML, and local-still server for sender/nonce binding, CSP, sandbox, permission/network/navigation denial, primary-preload exposure, one-use authorization, ledger validation, media-root/path safety, output verification, and atomic pending-file cleanup.
- Ran bounded Node-only security tests and typecheck; both passed.

## Residual risks

- The auditor did not access or decrypt `safeStorage` secrets and therefore did not independently recompute the profile-owned HMAC chain from the live key; source review, ledger/tail structure, restart-verification evidence, and tests were used.
- The auditor did not launch the packaged app, Python/CUDA worker, ComfyUI, cloud inference, or alter processes; runtime claims were audited from preserved native evidence and read-only source/package inspection.
- The auditor did not run Git in protected external roots; their integrity is based on current manifests and selected component hashes.
- Electron modal focus containment was source/capture/test verified rather than interactively redriven during this read-only re-audit.
