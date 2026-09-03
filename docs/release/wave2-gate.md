# Wave 2 Gate — Research Room and Llama-default Screenplay 2.0

Status: **GREEN** (genuine packaged Llama runtime gate passed and independent A07/A08/A64 audit accepted)

Canonical product: **Premiere316.exe**

Packaged build: **p316-20260903183552-c37b85ae52c1**
Renderer source hash: `c37b85ae52c15c8da68ba77aafc7a34abcdfba5a652b0eab1ca90986bef80b06`

Checkpoint base: `729c4d5` plus reviewed Llama-default architecture migration and A04 package harness repair. A03 source approval/release was recorded before A04 activated `WAVE-2-LLAMA-DEFAULT-PACKAGE`.

Wave 3 is **OPEN** for planning/implementation. Green tag: `wave2-p316-20260903183552-c37b85ae52c1`.

## Scope delivered (source + packaged offline)

- Llama 3.3 70B Instruct (`llama-3.3-70b-instruct`) is the default Movie Crew writer, critique-first Story Doctor, and prompt compiler identity.
- Qwen2.5 72B Instruct (`qwen2.5-72b-instruct`) remains optional only, exposed behind explicit alternate/second-opinion choices; the app never auto-runs both models.
- Six repository-local Movie Crew profiles route through `scripts/movie-crew-guard.mjs` external CLI instead of directly selecting a native local model. The guard refuses start/load commands and verifies exact already-loaded model IDs before any completion POST.
- Screenplay scoped rewrites preserve unrelated Fountain bytes/IDs/versions; tests cover full screenplay, act, sequence/chapter, scene, selected scenes, beat/dialogue/polish pathing, selected text, CRLF, title page, comments, ACT/SEQUENCE headings, stable IDs, explicit QA apply, and release/residency clearing.
- Research stage remains additive. Persist key remains `premiere316-v302-c`; migration preservation and approved Research snapshot handoff remain covered.
- Prompt Lab shows Llama default compiler and Qwen optional alternate; execution remains gated until Wave 5 and no media is generated.
- Electron security boundaries, 100–200% zoom, no cloud, no ComfyUI, and isolated user-data UAT were preserved.

## Source gates

| Gate | Result |
|---|---|
| `npm test` | **PASS — 249/249** (26 script/desktop + 223 typed) |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS**; `DATABASE_URL` unset migration skip expected |
| `git diff --check` | **PASS**; CRLF normalization warnings only |
| Movie Crew guard tests | **PASS** (included in script/desktop suite) |
| No-cloud runtime gate | **PASS** (included in script/desktop suite) |
| Electron preload/security | **PASS — 10/10** |
| Electron zoom unit gate | **PASS — 5/5** |

## Packaged Windows gates

| Gate | Result |
|---|---|
| Renderer mode | **PACKAGED DIST** |
| Build identity | **p316-20260903183552-c37b85ae52c1** |
| Packaged smoke | **PASS — isolated profile; Llama default writer/QA UI; explicit Qwen second opinion visible; no completion POST** |
| Stage visual matrix | **PASS — 22/22** (11 stages at 100% and 150%, native `webContents.capturePage()`; zero violations) |
| Visual policy violations | **0** |
| Console/page errors | **0 / 0** |
| Manual screenshot inspection | **PASS — Screenplay 100/150 and Prompt Lab 100/150 visibly usable; no blank/overlap failure observed** |
| Source/build identity | **PASS** — package build-info renderer hash `c37b85ae52c15c8da68ba77aafc7a34abcdfba5a652b0eab1ca90986bef80b06` matches final packaged smoke report |
| Start Menu shortcut | **PASS** — `C:\Users\teeja\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Premiere316.lnk` targets `D:\Projects\Premiere316_v3\dist-desktop\win-unpacked\Premiere316.exe` |
| Rollback proof | **PASS** — protected baseline tag `protected-baseline-p316-20260903075925-1b93dd668ab3`, Wave 1 tag, and external protected baseline backup are present |

Machine-readable reports: `screenshots/stage-visual/report.json`, `screenshots/premiere316-desktop-smoke.json`.

## Artifact hashes

- `Premiere316.exe`: `06b87db5bb7864e2eff5ecd37905b94ececa41a4ee0f0b09b4bbbbcb42428052`
- `resources/app.asar`: `70682644bd66ed9b8a868671fb0f914cafe414018ab09f35fda3712f2b97001d`
- `Premiere316-Setup.exe`: `3ca9a4cf103483a6e0f276c86cd988f731493d7277f6002152371262b36283e0`

## Protected data proof

Cold backup: `D:\Data\Backups\Premiere316\wave2-llama-default-a04-20260903T183058Z`

`%APPDATA%\Premiere316` before UAT and after UAT:

- file count: **312 / 312**
- manifest SHA-256: `f41a6ec42291ef2cc8bdfecd53cf3442196858c7c1ab2607c43954931b9f67ec`

Visual and smoke launched only against temp copied/isolated profiles. Final process check showed no `Premiere316`/`electron` processes remaining. No model weight under `D:\AI\Models` was written, moved, renamed, converted, copied, deleted, or loaded automatically.

## LM Studio packaged runtime gate

The operator explicitly started LM Studio Local Server and loaded exact `llama-3.3-70b-instruct` for this gate. A04 performed read-only native checks before each product inference phase. No lifecycle endpoint or CLI start/load command was issued. Qwen and Prompt Lab execution were not run.

Machine-readable runtime evidence: `screenshots/llama-runtime/report.json` plus native captures `00-ready-pinned.png`, `01-writer-output.png`, `02-qa-critique.png`, `03-scoped-revision.png`, `04-approval.png`, and `05-final-state.png`.

Runtime checks:

- `lms server status --json`: `{"running":true,"port":1234}` before the run.
- Native `/api/v1/models` checks before launch, writer rewrite, Story Doctor, and explicit scoped revision all found row key `llama-3.3-70b-instruct` with loaded instance id exactly `llama-3.3-70b-instruct`.
- Effective loaded context: **8192**; catalog max context: **131072**.
- Packaged UI pinned writer and Story Doctor to exact served ID `llama-3.3-70b-instruct`.
- Completion requests: **3** total (scene-scoped writer rewrite, critique-first Story Doctor, explicit scene-scoped writer revision aligned to the critique because QA returned no surgical `rewriteSuggested`). Cap was 4.
- QA persisted `fountainUnchanged: true`; Fountain hash before QA and after QA was identical: `16a2fcbdbbc0ac3ede313695b79ff461135d50708275d182e37cb9e137db4eff`.
- Explicit approval appended `Approved Screenplay`; prior seed and candidate versions remained retrievable.
- Unrelated second scene span stayed byte-identical across writer rewrite, scoped revision, and approval.
- Telemetry persisted exact model/role evidence: actual loaded model `llama-3.3-70b-instruct`, endpoint `http://127.0.0.1:1234`, local true, cloudFallback false, generationMs 23282, promptTokens 879, generatedTokens 195, peakVramBytes 67917316096, peakSystemRamBytes 56780537856; resource samples are coarse host/process-adjacent readings.
- Renderer observed zero forbidden `:8080` requests and zero Qwen POSTs.
- No intermediate unload/reload occurred; exact Llama remained loaded before the true end-of-workflow release.
- The visible `Release local model` action was clicked once at the user-authorized workflow boundary. Native unload succeeded (`loadedAfterRelease: []`), and no replacement model was started or loaded.

Live-data and process proof:

- `%APPDATA%\Premiere316` pre/post file count: **312 / 312**.
- `%APPDATA%\Premiere316` pre/post manifest SHA-256: `40f353068a343e7e2e761bbda589758c200ad43af57fa818dd0cc3824fbf0018` / `40f353068a343e7e2e761bbda589758c200ad43af57fa818dd0cc3824fbf0018`.
- Packaged runtime launched only with a fresh isolated temp profile, then deleted it.
- Final Premiere316/electron process check: **0**.

Optional Qwen A/B benchmark remains pending until explicitly selected and served by the operator; it was not run or fabricated and is non-gating for the Llama-default Wave 2 acceptance.

## Independent audit

| Auditor | Run | Verdict | Finding |
|---|---:|---|---|
| A07 · Test Strategy Lead | `4a98c969-df0c-4620-ac8f-73e4bb7170d3` | **PASS** | Accepted source/package/runtime evidence. |
| A64 · Final Independent UAT / Red Team | `276dd530-a024-427b-951e-139666fc520f` | **PASS** | Accepted genuine packaged Llama runtime evidence, data protection, exact identity, and final release. |
| A08 · Release & Change Manager initial audit | `ce481324-11fd-4bf9-ab8d-cc75b2503137` | **VETO RESOLVED** | Blocked only stale orchestration ledgers; no product/package/runtime defect. Nonblocking note: Qwen POST detection could be strengthened by body model-ID logging in a future harness. |
| A08 · Release & Change Manager re-audit | current re-audit after `ab9d07b` | **PASS** | Confirmed ledger-only reconciliation, 64 logical roles, five-agent concurrency cap, clean ancestry from runtime evidence, and Wave 3 closed until A01 finalization. |

## Gate decision

Wave 2 source, package, isolated offline UAT, shortcut, rollback evidence, live user-data identity, genuine packaged Llama runtime flow, and independent A07/A08/A64 audit **PASS**.

The packaged build remains byte-identical to the runtime-tested package: `p316-20260903183552-c37b85ae52c1` with `Premiere316.exe` hash `06b87db5bb7864e2eff5ecd37905b94ececa41a4ee0f0b09b4bbbbcb42428052`, `resources/app.asar` hash `70682644bd66ed9b8a868671fb0f914cafe414018ab09f35fda3712f2b97001d`, and installer hash `3ca9a4cf103483a6e0f276c86cd988f731493d7277f6002152371262b36283e0`.

Wave 2 is **GREEN** and Wave 3 is **OPEN** for its dependency-root work. Later waves remain blocked by their previous packaged gates.
