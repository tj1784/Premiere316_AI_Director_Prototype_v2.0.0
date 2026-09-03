# Wave 2 Gate — Research Room and Llama-default Screenplay 2.0

Status: **BLOCKED_EXTERNAL_RUNTIME** (Llama-default pending-runtime package checkpoint)

Canonical product: **Premiere316.exe**

Packaged build: **p316-20260903183552-c37b85ae52c1**
Renderer source hash: `c37b85ae52c15c8da68ba77aafc7a34abcdfba5a652b0eab1ca90986bef80b06`

Checkpoint base: `729c4d5` plus reviewed Llama-default architecture migration and A04 package harness repair. A03 source approval/release was recorded before A04 activated `WAVE-2-LLAMA-DEFAULT-PACKAGE`.

Wave 3 is **not** opened. No green tag was created.

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

## LM Studio read-only probe / fail-closed proof

Read-only native state checks only; no server/model start, load, reload, unload, or ComfyUI/cloud invocation was performed.

- `lms server status --json`: `{"running":false,"port":1234}`
- `lms ps --json`: exact `llama-3.3-70b-instruct` catalog row present but `status":"idle"`; not served over HTTP.
- `curl http://127.0.0.1:1234/api/v1/models`: connection failed.
- `curl http://127.0.0.1:1234/v1/models`: connection failed.
- Packaged smoke recorded `servedModels: 0`, `generationEnabled: false`, `network.completionPosts: 0`, `network.probed8080: 0`.

S-001 / S-002 / S-003 genuine packaged draft → critique → explicit scoped revision → approval was **not run and is not waived** because the exact Llama runtime is not already served. Qwen A/B benchmark remains pending until explicitly selected and served by the operator.

## Gate decision

Wave 2 source, package, isolated offline UAT, shortcut, rollback evidence, and live user-data identity **PASS**.

Wave 2 product acceptance remains **BLOCKED_EXTERNAL_RUNTIME** until the operator already serves exact `llama-3.3-70b-instruct` through LM Studio Local Server and packaged user-triggered Llama draft → isolated critique-first QA → explicit scoped revision/application → approval is proven. Optional Qwen A/B remains pending and must not be fabricated or auto-run.

Do **not** open Wave 3. Do **not** green-tag this checkpoint.
