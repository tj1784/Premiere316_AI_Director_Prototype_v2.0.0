# A07 Wave 4 replacement-candidate re-audit

- Candidate: `p316-20260904124249-f8c5609e32d4`
- Renderer/source hash: `f8c5609e32d4642132076347b74b7f07ed1495430a8d1fa6de0ee41e15a36999`
- Workflow: `544b1c84-b21f-4360-8a3b-f3719851037a`
- Child run: `4f86a2e6-1a45-48ae-a064-c96a928e3564`
- Verdict: **PASS**

## Summary

Inherited decisions: the previous A07 veto blocked candidate `p316-20260904115717-f8c5609e32d4` for two issues: false visual confirmation of a `night` lock on daylight images, and contradictory evidence/prose around an uploaded one-pixel reference fixture. The current authoritative acceptance set is only `docs/release/wave4-gate.md` plus `screenshots/wave4-native/` current artifacts for candidate `p316-20260904124249-f8c5609e32d4`; historical failures are not acceptance evidence.

Diagnosis: the two prior blockers are closed in the current candidate. `scripts/wave4-native-uat.mjs` no longer contains a `onePixel` fixture or `setInputFiles` product action; it explicitly removes stale `reference.png`, uses `app.evaluate` only for native capture, isolated-profile-path verification, and read-only `nativeImage` luminance inspection, and drives product actions through visible controls/main-owned confirmation windows. The authority capture and sidecars are reference-free, the exact receipt lock is now `visible exterior night sky`, both current PNGs are genuine dark exterior-night images by independent visual inspection, and only the canonical industrial-exterior candidate's checkbox is checked while the rejected urban-street candidate remains unchecked.

Mechanical evidence is internally consistent: package/source hashes match; tests and typecheck pass in the auditor's read-only rerun; build/package/smoke/stage evidence reports pass; UAT produced exactly two distinct 512×512 FLUX.1 outputs from the same prepared root, distinct seals/tokens/seeds, same-worker cold/warm telemetry, no pending/temp outputs, exactly one final visible release, and restart recovery with no model auto-load.

Recommendation: A07 passes this candidate. Wave 5 remains closed until A01 creates the immutable checkpoint/tag.

## Blockers

- None.

## Findings

### INFO: Prior blocker 1 retested — visible continuity confirmation is now truthful

Generated PNGs visually inspected: `14718638-...4fe0d08a.png` is a dark industrial exterior with night sky, wet pavement, and practical lamps; `ace5017a-...a13308b4.png` is a dark wet urban exterior/street candidate. `screenshots/wave4-native/captures/13-rejected-one.png` shows the first/urban rejected card's `visible exterior night sky` checkbox unchecked; `screenshots/wave4-native/captures/14-approved-one.png` shows the second/industrial canonical card checked. `security-ledger.v1.jsonl` binds rejection to `receipt:625a88...` / `a13308b4...` and canonical approval to `receipt:a6f18...` / `4fe0d08a...`, with canonical continuity `confirmed:true` for `visible exterior night sky`.

### INFO: Prior blocker 2 retested — no generated reference fixture/import path in current accepted UAT

`scripts/wave4-native-uat.mjs` has no `setInputFiles`/`onePixel` upload flow and explicitly removes `screenshots/wave4-native/reference.png`. No current `screenshots/wave4-native/reference.png` exists. The authority-review capture shows `references:[]` for the Wave 4 asset; both provenance sidecars show `references: []`. No `reference.png`, data URL, or base64 reference appears in current generated sidecars/ledger evidence.

### INFO: Source/package identity independently confirmed

Independent SHA-256 recomputation matched current claims: `Premiere316.exe` `e0a37bbfb72b6c744fe5062a047d68c8dabd4d89ad5d846d2b8f7f14c8a0501c`; `app.asar` `ded6af1c2716bc7762b5f6b3ebd730c5564781bf90afa0746dfe72799f453c7c`; installer `e0b1206cfb3672dc7e5e86fba039b482e68510164a4ad4621d90bd80424ccdbd`; `backend.mjs` `6f2ea7d...`; worker `8c37b861...`; UI server `692a28a6...`. `package/source-build-identity.json` reports renderer hash `f8c5609e...` matching desktop and packaged build-info.

### INFO: Tests and typecheck passed in this audit

The auditor ran bounded Node-only `npm test -- --runInBand && npm run typecheck`; output reports 255 tests / 52 suites passed, zero failed, and `tsc --noEmit` completed without errors.

### INFO: Packaged UAT mechanics are consistent with the gate

`screenshots/wave4-native/report.json` has `ok:true`, generated count 2, `pendingFiles:[]`, no console/page errors, zero POSTs, and zero requests containing 8188. Both jobs used worker PID 71148. Visible-night metrics are mean intensity 41.89 and 44.10 with dark-pixel ratios 0.9431 and 0.8967. The luminance precheck was treated as supplemental; this pass is based on independent visual inspection plus ledger/capture consistency.

### INFO: Fourteen-stage visual, smoke, preservation, and cleanup evidence are consistent

`stage-visual/report.json` has `ok:true` with 28 captures across 14 stages at zooms 100 and 150 and zero violations/errors. `premiere316-desktop-smoke.json` has `ok:true` with no completion POST and no model auto-load. `live-data-compare.json` is byte-identical; `exact-component-hashes-compare.json` is all-identical; `external-roots-after-summary.json` is metadata-identical for every protected root; `process-preservation.json` has `preservedAll:true` and residual count zero; `isolated-profile-cleanup.json` has remaining count zero.

## Checks

- Reconstructed the current contract and prior A07 veto from the stored context and current gate document.
- Used only current authoritative evidence paths; historical acceptance/failure artifacts were background for prior blockers only.
- Visually inspected both current generated PNGs and the authority-review, two-iteration review, rejection, canonical approval, and restart-recovery native captures.
- Inspected `scripts/wave4-native-uat.mjs` for prohibited product-action bypass and `app.evaluate` usage; verified no one-pixel/reference upload or `setInputFiles` action remains.
- Searched current generated evidence for `reference.png`, data URLs, base64 reference attachments, and verified sidecars contain `references:[]`.
- Parsed ledger entries for exact lock text, distinct seals/tokens/receipts, common prepared root, canonical/rejection receipt/file binding, and canonical-only continuity confirmation.
- Independently hashed current package artifacts and generated PNGs.
- Ran bounded Node-only tests/typecheck; did not build, package, launch model/media workers, contact ComfyUI/cloud, access `safeStorage` secrets, mutate external roots, or run Git in protected roots.
- Reviewed stage-visual, smoke, preservation, process, component-hash, external-root, and cleanup reports for internal consistency.

## Residual risks

- The auditor did not rerun packaged Electron UAT or invoke Python/CUDA/model inference; runtime genuineness was audited from preserved evidence, source, and hashes rather than re-executed.
- The auditor did not decrypt or validate `safeStorage`-protected HMAC secrets; ledger cryptographic validity was accepted to the extent exposed by reports/source/tests without secret access.
- The rejected urban image has a bluish ambient sky but is still visibly a dark exterior/wet night-like candidate; it was not used for canonical continuity confirmation and is not a blocker.
