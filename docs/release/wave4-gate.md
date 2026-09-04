# Wave 4 Gate — genuine packaged FLUX.1 runtime

Status: `GREEN`

Wave 4 is GREEN for packaged-runtime candidate `p316-20260904124249-f8c5609e32d4` after remediation of the prior A07 veto and unanimous independent A07/A08/A64 replacement-candidate re-audits. The accepted run used visible controls in `Premiere316.exe`, a fresh isolated profile, main-owned confirmation windows, the app-owned offline FLUX.1 worker, and native `webContents.capturePage()` evidence. It used no direct preload/backend/IPC/RPC calls to perform product actions, no renderer state injection, no mock or imported output, no generated reference fixture, no manual Python invocation, no ComfyUI workflow, and no cloud inference.

A01 recovered the final checkpoint after the conditional workflow's A01 child exhausted its orchestration token budget without producing a persisted child session. The three completed independent audit results remained valid and unanimous; no runtime gate was reopened. Wave 5 remains closed. This GREEN checkpoint does not authorize a later wave until a separate controlled transition.

## Current package identity

- Build ID: `p316-20260904124249-f8c5609e32d4`
- Renderer source hash: `f8c5609e32d4642132076347b74b7f07ed1495430a8d1fa6de0ee41e15a36999`
- Mode: `PACKAGED DIST`
- `Premiere316.exe`: `e0a37bbfb72b6c744fe5062a047d68c8dabd4d89ad5d846d2b8f7f14c8a0501c` (205,438,464 bytes)
- `resources/app.asar`: `ded6af1c2716bc7762b5f6b3ebd730c5564781bf90afa0746dfe72799f453c7c` (122,339 bytes)
- installer: `e0b1206cfb3672dc7e5e86fba039b482e68510164a4ad4621d90bd80424ccdbd` (88,893,642 bytes)
- `resources/backend.mjs`: `6f2ea7ded467b6f8a2e37df37a21b1623774c3ce2e0840b5e48f9331a3dcbb86`
- packaged worker: `8c37b861137eb7d7b7d35b3966a6599ac034052844caab5aa707167e46032678`
- packaged UI server entry: `692a28a68665fad4762c12ba0334c4e9dd619af1e15719f4e7f2180772e5c430`
- packaged resources: 57 files, 4,851,492 bytes, aggregate manifest `e2c0430d0379990a5634e992ed040e5fc8ff531227d7e471cf56077b6afb6be6`

`desktop/build-info.json`, packaged `resources/build-info.json`, and an independent renderer-source recomputation agree byte-for-byte. Package identities are recorded in `screenshots/wave4-native/package/`.

## Source and package gates

| Gate | Result |
|---|---|
| `npm test` | PASS — 255/255 |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| JS syntax, orchestration JSON, `git diff --check` | PASS |
| `npm run electron:pack` | PASS; required ASAR modules and external resources audited |
| Packaged zero-inference smoke | PASS; clean console, no completion POST, no model auto-load, all 14 stages navigable, zoom persistence verified |
| Native packaged visual matrix | PASS — 28/28 `capturePage()` captures at 100% and 150%, no violations/errors/overflow |

The authority-review preload now implements Escape cancellation, keyboard focus containment, and initial Cancel focus. The packaged authority capture visibly shows Cancel as the default-focused action.

## Accepted visible packaged UAT candidate

Authoritative report: `screenshots/wave4-native/report.json` (`ok: true`). Machine summary: `screenshots/wave4-native/summary-report.json`. Accepted transcript: `screenshots/wave4-native/wave4-native-uat-accepted.log`.

The isolated run visibly performed:

1. opened The Last Reel and established approved Research, Inventory, Visual Development, and Cinematography prerequisites;
2. created and approved a prepared asset specification using product controls, with the exact visible continuity lock `visible exterior night sky`;
3. evaluated prepared assets without uploading or attaching a reference file;
4. reviewed all 69,445 characters of the backend-normalized authority document in the isolated main-owned review window and sealed it;
5. canceled one prepared approval and proved no privilege was granted;
6. visibly confirmed one prepared approval;
7. visibly confirmed two separate Generate actions with distinct one-use seals/tokens and no intermediate release or restart;
8. displayed two real candidates side by side and recorded conservative darkness metrics before any continuity acknowledgement;
9. left the rejected candidate's blocker unchecked, checked only the visibly qualifying canonical candidate, and entered image-specific review reasons;
10. visibly confirmed one signed rejection and one signed canonical approval;
11. clicked the visible final Release action exactly once;
12. relaunched the same isolated profile and recovered both backend decisions with no model auto-load.

The authority document and both provenance sidecars contain no `reference.png`, data URL, base64 reference, or reference attachment. Each sidecar records `references: []`.

## Exactly two genuine FLUX.1 outputs

Both preserved PNGs are distinct, decodable, nontrivial 512×512 images generated from one approved prepared root by `flux1-dev` through the official local `black-forest-labs/flux` implementation:

| Iteration | Decision | SHA-256 | Bytes | Seed | Residency | Load / inference |
|---|---|---|---:|---:|---|---|
| cold | rejected | `a13308b4a38d4c6dc2d876698beb35124767ab0626fc50efe00c3cdaaad80f85` | 404,712 | 1820113421 | before `false`, after `true` | 126,630 ms / 21,245 ms |
| warm | canonical | `4fe0d08abe0cee3ae24a14575f73e9d7bda38d7d1e58b28c738594f0e3bc29b1` | 348,225 | 1820335395 | before `true`, after `true` | 0 ms / 9,511 ms |

- Both jobs used packaged worker PID 71148 and identical worker/component digests.
- Peak measured VRAM for each job was 57,721,827,328 bytes.
- The worker had zero TCP sockets after each generation.
- Native-image precheck metrics were 44.10 mean intensity / 0.8967 dark-pixel ratio for the cold image and 41.89 / 0.9431 for the warm image.
- Direct visual inspection confirms both are dark, rain-wet exterior night scenes. The canonical industrial exterior visibly shows a dark exterior sky, practical lights, wet architecture, and a more defensible archive setting than the rejected urban-street candidate.
- Only the canonical candidate's `visible exterior night sky` checkbox was acknowledged. The rejected candidate remained unchecked.
- No `.pending.png` or `.tmp.png` survived atomic finalization.
- The worker was absent after the one visible release and remained absent after restart.

The two PNGs, provenance sidecars, ledger, signed tail, and worker log are preserved under `screenshots/wave4-native/generated/`. Key native captures are `captures/12-review-two-iterations.png`, `captures/13-rejected-one.png`, `captures/14-approved-one.png`, and `captures/16-restart-ledger-verified.png`.

## Signed authority and decision chain

The copied profile-owned HMAC ledger contains exactly eight chained, unique records:

- authority: `authority:51513fe53ed0c1f4eeaae4cbbb0a2da8`
- prepared approval: `preparedApproval:27cc0c3de37e1fb47b2522729c18d60a`
- seals: `seal:acad4fc0a2c6e6f423a4a44adc12f3f7`, `seal:0d41dabfa4b4a83048e676bd23213f51`
- receipts: `receipt:625a88b38f6ac3b536cf47182d0aab95`, `receipt:a6f18aca963de6ebcb2af24e9b0d780e`
- rejection: `rejection:cfae5694d76eb91452360ce2de6fd797` for the cold image
- canonical decision: `canonical:d34f1e3156f1267199b56a6529d371e9` for the warm image

Sequence numbers, previous-MAC links, unique IDs, and the signed tail count of eight all validate. The canonical entry binds the exact warm receipt and records `visible exterior night sky` as confirmed; that is consistent with the preserved image and native captures. Both receipts have distinct seals and token digests but the same worker identity digest `c53015efde0599d7f341c5f0ead3e6d4ebe2003ec2036e153168e30f19b75066` and component digest `5eee224a62f7f5cb9e32051d76f0ba4664c92d1845f34c9e09c93ed6902f6e03`.

## Offline and preservation proof

- No request contacted port 8188 and there was no inference/completion POST.
- The app-owned FLUX worker owned zero TCP connections during both jobs.
- The branding-extension GET remains present as required platform chrome; it is not inference.
- `%APPDATA%\Premiere316` remained byte-identical across 312 files and 31,063,501 bytes; before/after normalized manifest hash: `118052f7a5695e7a9339c07be6b17c7df56eb5d7e20680121c6bbf26ffb875ca`.
- Full selected-component SHA-256 hashes before and after are identical for FLUX, AE, T5, CLIP, BPE/tokenizer, and the pinned T5 snapshot files.
- Counts and bytes remain identical for `D:\AI\Models`, `D:\Projects\flux`, `D:\Projects\Flux2`, `D:\_Cache\HuggingFace`, and `D:\Dev\Tools\Python312`.
- All six baseline LM Studio processes and operator-owned ComfyUI PID 37076 survived with the same command lines.
- No Premiere316 or app-owned FLUX worker process remained after release/restart.
- No retained `premiere316-wave4-native-*` profile remains.

Primary preservation evidence: `live-data-compare.json`, `exact-component-hashes-compare.json`, `external-roots-after-summary.json`, `process-preservation.json`, `final-baseline/`, and `isolated-profile-cleanup.json`.

## Independent replacement-candidate audits

| Auditor | Child run | Verdict | Scope |
|---|---|---|---|
| A07 | `4f86a2e6-1a45-48ae-a064-c96a928e3564` | **PASS** | Visible continuity truth, packaged-UAT legality, current evidence |
| A08 | `c0000148-adc3-4c1c-81d9-e33a9005f63d` | **PASS** | Package/release identity, live data, protected roots, process preservation |
| A64 | `a137d777-8c68-44bc-b291-f97e621df39e` | **PASS** | Adversarial trust boundary, modal isolation, ledger authority, offline behavior |

The audits ran independently in workflow `544b1c84-b21f-4360-8a3b-f3719851037a`. Full reports are `docs/release/audits/wave4-final-A07.md`, `wave4-final-A08.md`, and `wave4-final-A64.md`. A64 recorded one non-blocking ordering quirk in a report array; hashes, timestamps, receipts, sidecars, and signed decisions resolve cold/warm identity unambiguously.

## Alternative-runtime disposition

Wave 4's verified runtime is FLUX.1 only. FLUX.2 Dev, Klein 4B/9B, and Krea 2 were not selected as substitute acceptance paths and were not represented as verified runtimes. Their discovered configurations remain visible but fail closed as disabled/Labs-only or incomplete until a later independently gated implementation proves exact components, compatible official runtime semantics, license posture, and packaged execution. Optional Qwen work likewise remains explicit and unrun; Llama 3.3 70B remains the default writer, independent QA model, and prompt compiler.

## Prior veto and remediation

Candidate `p316-20260904115717-f8c5609e32d4` remains explicitly rejected. A07 found that its canonical decision falsely confirmed `night` while the images were daylight and that its gate text denied imported media despite a generated one-pixel reference attachment. A08 and A64 passed the mechanical release/data and security surfaces, but A07's veto blocked the candidate.

Recovery made the following narrow corrections:

- removed the generated one-pixel reference and its upload action;
- asserted that authority/provenance contains no reference fixture;
- strengthened the prompt and exact continuity lock to a directly visible exterior-night property;
- added a conservative native-image darkness precheck before acknowledgement;
- checked only the canonical candidate's finding and selected the visibly qualifying candidate;
- made reviewer reasons image-specific and truthful;
- added Escape/focus/Cancel-default behavior to the authority-review window and regression assertions;
- created a fresh package and ran the entire isolated packaged UAT again.

Complete veto records are under `docs/release/audits/`; relevant prior evidence is under `screenshots/wave4-audit-history/`. Historical candidates are not acceptance evidence.

## Final checkpoint

All three independent auditors passed the corrected candidate with no blockers. A01 marked I-001 through I-008 GREEN, ran the checkpoint-ready evidence validator, committed the intended Wave 4 source/configuration/tests and curated current/historical evidence, and created annotated tag `wave4-p316-20260904124249-f8c5609e32d4` on the final governance checkpoint.

Wave 5 and Waves 6–8 remain `BLOCKED_BY_PREVIOUS_GATE`. Opening Wave 5 requires a separate controlled transition; it is deliberately not part of this checkpoint.
