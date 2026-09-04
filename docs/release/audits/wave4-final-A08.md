# A08 Wave 4 replacement-candidate release/data re-audit

- Candidate: `p316-20260904124249-f8c5609e32d4`
- Renderer/source hash: `f8c5609e32d4642132076347b74b7f07ed1495430a8d1fa6de0ee41e15a36999`
- Workflow: `544b1c84-b21f-4360-8a3b-f3719851037a`
- Child run: `c0000148-adc3-4c1c-81d9-e33a9005f63d`
- Verdict: **PASS**

## Summary

A08 Release & Data re-audit PASS for replacement candidate `p316-20260904124249-f8c5609e32d4`. The previous `p316-20260904115717-f8c5609e32d4` A07-vetoed build was treated as historical only and the auditor used the current authoritative Wave 4 evidence set. The replacement package identity, renderer/build-info agreement, package/resource manifests, packaged authority-review preload exactness, generated artifacts, live-data equality, protected-root preservation, selected-component hash equality, ambient-process preservation, isolated-profile cleanup, no-secret scan, and Wave 5/tag gating are internally consistent. No A08 blocker remains. Wave 5 remains closed pending A01's immutable checkpoint/tag.

## Blockers

- None.

## Findings

### INFO: Inherited gate contract reconstructed and applied

`docs/release/wave4-gate.md` identified status `PACKAGE_PASS_AWAITING_A07_A08_A64_REAUDIT`, current candidate `p316-20260904124249-f8c5609e32d4`, the prior `p316-20260904115717-f8c5609e32d4` candidate as veto history, and the requirement that Wave 5 stay closed until fresh A07/A08/A64 passes and A01 creates the immutable checkpoint/tag.

### INFO: Independent package hashing matches the replacement candidate identity

Read-only Node hashing returned: `Premiere316.exe` 205,438,464 bytes, SHA-256 `e0a37bbfb72b6c744fe5062a047d68c8dabd4d89ad5d846d2b8f7f14c8a0501c`; `resources/app.asar` 122,339 bytes, `ded6af1c2716bc7762b5f6b3ebd730c5564781bf90afa0746dfe72799f453c7c`; `Premiere316-Setup.exe` 88,893,642 bytes, `e0b1206cfb3672dc7e5e86fba039b482e68510164a4ad4621d90bd80424ccdbd`; `backend.mjs` 155,417 bytes, `6f2ea7ded467b6f8a2e37df37a21b1623774c3ce2e0840b5e48f9331a3dcbb86`; `flux1_jsonl_worker.py` 18,509 bytes, `8c37b861137eb7d7b7d35b3966a6599ac034052844caab5aa707167e46032678`; and `ui/server/index.mjs` 39,228 bytes, `692a28a68665fad4762c12ba0334c4e9dd619af1e15719f4e7f2180772e5c430`.

### INFO: Renderer source and packaged build-info agree

`screenshots/wave4-native/package/source-build-identity.json` reports source hash `f8c5609e32d4642132076347b74b7f07ed1495430a8d1fa6de0ee41e15a36999`, build ID `p316-20260904124249-f8c5609e32d4`, renderer mode `PACKAGED DIST`, `sourceMatchesDesktop:true`, `sourceMatchesPackaged:true`, and `buildInfoIdentical:true`. Package build-info carries app version 3.0.2 and timestamp `2026-09-04T12:42:49.151Z`.

### INFO: The 57-file packaged resources manifest is complete and matches its digest

`screenshots/wave4-native/package/runtime-resources-manifest.json` reports root `dist-desktop/win-unpacked/resources`, 57 files, 4,851,492 bytes, and manifest SHA-256 `e2c0430d0379990a5634e992ed040e5fc8ff531227d7e471cf56077b6afb6be6`. It includes ASAR, backend, build-info, UI public/server assets, model-catalog cache, icon/elevate, and worker resources.

### INFO: Packaged authority-review preload exactness verified

The auditor parsed `dist-desktop/win-unpacked/resources/app.asar` read-only and extracted `desktop/authority-review-preload.cjs` metadata. The ASAR entry integrity hash is `ba1991c1138dc50cf522ea3461d358bb085767e4906291cf36e956ab0ee303ce`, size 2,855 bytes; extracted content matches source exactly. `final-validation.json` independently records packaged-preload equality and Escape/focus-trap/Cancel-default checks as passing. `captures/06-authority-review-main-owned.png` visibly shows the isolated authority-review window with Cancel focused before sealing.

### INFO: Current accepted UAT evidence is distinct from historical failure evidence

Current `screenshots/wave4-native/report.json` has `ok:true` for packaged `Premiere316.exe` and lists the current native `capturePage()` evidence. The authoritative current evidence lives under `screenshots/wave4-native/`; `docs/release/audits/` and `screenshots/wave4-audit-history/` are explicitly historical and were not used as acceptance proof.

### INFO: Exactly two final generated PNGs and sidecars are present; no pending/temp/reference fixture exists

`screenshots/wave4-native/generated/` contains exactly two PNGs, two provenance sidecars, `flux1-worker.log`, `security-ledger.v1.jsonl`, and its signed tail. No `*reference*`, `*.pending.png`, or `*.tmp.png` exists in the current generated directory. Generated JSON contains no `reference.png`, data URL, or base64 attachment; both sidecars report `references: []`.

### INFO: Generated PNG hashes and visual evidence match the current report

Independent hashes: `ace5017a-e46f-4445-bc1d-b1237938072a.a13308b4a38d4c6dc2d87669.png` is 404,712 bytes, SHA-256 `a13308b4a38d4c6dc2d876698beb35124767ab0626fc50efe00c3cdaaad80f85`, and has a 512×512 PNG header. `14718638-7d11-46db-b102-a4c949b74635.4fe0d08abe0cee3ae24a1457.png` is 348,225 bytes, SHA-256 `4fe0d08abe0cee3ae24a14575f73e9d7bda38d7d1e58b28c738594f0e3bc29b1`, also 512×512. The auditor visually inspected both: the rejected image is a dark wet urban street; the canonical image is a dark rain-wet industrial exterior with visible night sky and practical lighting. Native captures show both candidates, canonical/rejected state, and restart recovery.

### INFO: Signed ledger, receipts, and release/restart state are internally consistent

`summary-report.json` reports an eight-entry ledger: one production authority, one prepared approval, two seals, two generation receipts, one rejection decision, and one canonical decision; sequence and unique-ID checks pass. The cold `a13308...` receipt is rejected; the warm `4fe0d...` receipt is canonical. Residency evidence has `sameWorkerPid:true`, worker PID 71148, one worker after each generation, no worker TCP connections, worker count zero after visible release and restart, and `restartLedgerVerified:true`.

### INFO: Live `%APPDATA%` profile remained byte-identical

`screenshots/wave4-native/live-data-compare.json` reports `C:\Users\teeja\AppData\Roaming\Premiere316` at 312 files before and after, manifest SHA-256 `118052f7a5695e7a9339c07be6b17c7df56eb5d7e20680121c6bbf26ffb875ca` before and after, no differences, and `byteIdentical:true` / `same:true`.

### INFO: Protected external roots retained counts and bytes

`external-roots-after-summary.json` reports `metadataIdentical:true` for `D:/AI/Models` (818 files, 335 directories, 2,310,237,986,323 bytes), `D:/Projects/flux` (103 files, 32 directories, 77,126,456 bytes), `D:/Projects/Flux2` (73 files, 32 directories, 95,573,984 bytes), `D:/_Cache/HuggingFace` (65 files, 51 directories, 53,202,038,520 bytes), and `D:/Dev/Tools/Python312` (72,157 files, 7,795 directories, 5,656,102,517 bytes). The auditor did not run Git or mutate these roots.

### INFO: Selected full external-component hashes are unchanged

`exact-component-hashes-compare.json` has `allIdentical:true` for ten comparisons, including FLUX transformer `4610115b...`, AE `afc8e282...`, T5 `6e480b09...`, CLIP `660c6f5b...`, OpenCLIP BPE `924691ac...`, tokenizer source `90d743e4...`, and pinned T5 snapshot files.

### INFO: All ambient LM Studio and ComfyUI PIDs were preserved; no residual app/worker remained

`process-preservation.json` reports baseline ambient count seven and `preservedAll:true`, with identical command lines for six LM Studio PIDs 23356, 23756, 19552, 20712, 20972, 53312 and operator-owned ComfyUI PID 37076. `premiere316OrWorkerResidual` is empty and residual count is zero.

### INFO: Isolated-profile cleanup and artifact durability are evidenced

`isolated-profile-cleanup.json` reports captured time `2026-09-04T13:04:17.082Z`, no matched/remaining profiles, and remaining count zero. Current evidence directories retain generated media/sidecars/ledger/tail/worker log, 22 native UAT captures, package identity/manifests, and final preservation baselines.

### INFO: Smoke/visual package gates are consistent with release/data claims

`premiere316-desktop-smoke.json` has `ok:true` for the replacement build, no completion posts, no model auto-load, no console errors, all 14 stages navigable, and `realProfileUntouched` set to the live profile. `stage-visual/report.json` has `ok:true`, 14 stages, 28 captures, and no violations/console/page errors.

### INFO: No secret/key leakage found in current audited scope

Pattern searches across current Wave 4 evidence and packaged text resources found no `XAI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AWS_SECRET`, private-key blocks, `sk-*`-style keys, `xai-*`-style keys, or Google API key patterns.

### INFO: Wave 5 remained closed and no Wave 4 tag/checkpoint existed during audit

At audit time, `wave-status.json` recorded Wave 4 pending re-audit and Wave 5 `BLOCKED_BY_PREVIOUS_GATE`; only protected baseline and Wave 1–3 tags existed. A01 checkpoint/tag remained the sole pending release action.

## Checks

- Read `docs/release/wave4-gate.md` first and applied its current package/data contract after the prior A07 veto.
- Inspected only current authoritative evidence under `screenshots/wave4-native/` plus current wave status/tag refs; historical audit folders were not acceptance evidence.
- Independently hashed EXE, ASAR, installer, backend, packaged worker, packaged UI server, and both final PNGs using Node only.
- Parsed the ASAR header read-only to verify packaged `desktop/authority-review-preload.cjs` content equals source and matches the ASAR integrity block.
- Visually inspected both current generated PNGs and authority review, two-iteration review, canonical/rejection, and restart-ledger captures.
- Checked `final-validation.json` (36/36), package/source identities, resource manifest, reference-free media, ledger, smoke, stage visual, live data, external roots, processes, cleanup, and gate checks.
- Checked generated-directory contents and searched for pending/temp/reference indicators.
- Checked live-data, external-root, exact-component-hash, process-preservation, isolated-profile-cleanup, smoke, and stage-visual reports.
- Searched current evidence and packaged text resources for common secret/API-key/private-key patterns.
- Confirmed Wave 5 closure and absence of the current Wave 4 tag/checkpoint without creating either.

## Residual risks

- A08 release/data pass did not decide A07 visual-continuity acceptance or A64 adversarial security acceptance; those independent vetoes were still required at audit completion.
- External-root preservation relies on recorded final-baseline/current evidence and selected full-hash comparisons; the auditor did not enter protected repositories with Git or re-hash entire multi-terabyte model roots.
- The auditor did not access `safeStorage` secrets or trust renderer/local-storage state; ledger/security conclusions use copied evidence, package hashes, native captures, and validation summaries rather than secret-key verification.
