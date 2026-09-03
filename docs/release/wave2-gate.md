# Wave 2 Gate — Research Room and Screenplay 2.0

Status: **BLOCKED_EXTERNAL_RUNTIME** (pending-runtime checkpoint)

Canonical product: **Premiere316.exe**

Packaged build: **p316-20260903163328-7a3bdec93225**
Renderer source hash: `7a3bdec93225fb0a4cb088b7b5e6894d7efdeb5306d3b097f6d1fbfb91405750`

Wave 3 is **not** opened. No green tag.

## Scope delivered (source + packaged offline)

- New StageId `"research"` after Intake. New pictures land Intake→Research. Persist key remains `premiere316-v302-c`.
- Additive Picture Research Bible: local-only default, web-assisted stub with no network, sources/quotes/A–D/locators/disputes, social-world + cinematic expression, cinematography research, append-only versions, approve + delta.
- Research workspace is stage-owned (no generation rails, no timeline, no shell Rewrite).
- Screenplay generation stays disabled until Research is approved **and** an exact currently served Qwen id is selected.
- Story Doctor requires a separate exact currently served Llama id; critique-first; Fountain changes only via explicit scoped revision.
- Packaged UAT at native 100% and 150% walked Intake through Export, including Research and Screenplay 2.0.
- Isolated user-data directories were used for both visual and smoke UAT. Live `%APPDATA%\Premiere316` was cold-backed and restored as an identity.

## Source gates

| Gate | Result |
|---|---|
| `npm test` | **PASS — 220/220** |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `git diff --check` | **PASS** |
| Electron preload/security | **PASS — 10/10** |
| Electron zoom unit gate | **PASS — 5/5** |

## Packaged Windows gates

| Gate | Result |
|---|---|
| Renderer mode | **PACKAGED DIST** |
| Build identity | **p316-20260903163328-7a3bdec93225** |
| Packaged smoke | **PASS — isolated profile** |
| Stage visual matrix | **PASS — 22/22** (11 stages at 100% and 150%, native `capturePage()` 1424×861) |
| Visual policy violations | **0** |
| Console/page errors | **0 / 0** |
| Manual screenshot inspection | **PASS — Research and Screenplay 100/150 plus Generate/Stitch samples** |
| LM Studio HTTP | **UNREACHABLE** `http://127.0.0.1:1234` and `http://localhost:1234` timed out; app fail-closed |
| Exact served Qwen + Llama pair | **ABSENT** — `lms ps` showed idle `qwen2.5-72b-instruct` only; no Llama; HTTP API not serving. LMS was **not** started and no model was loaded. |
| Native image capability gate | **PASS — unavailable configurations remain disabled** |
| Timeline visibility | **PASS — Stitch only** |
| Start Menu shortcut | **PASS —** `C:\Users\teeja\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Premiere316.lnk` → `D:\Projects\Premiere316_v3\dist-desktop\win-unpacked\Premiere316.exe` |

Machine-readable reports: `screenshots/stage-visual/report.json`, `screenshots/premiere316-desktop-smoke.json`.

## Artifact hashes

- `Premiere316.exe`: `6cce7b43b2a90b26dce57f89349726f290129618f6bef125b3facefe67d9f0ba`
- `resources/app.asar`: `4be85fb9bab01511f9ee1a2577452d8d8902dc96c4cf2189abdc3159c9c90153`
- `Premiere316-Setup.exe`: `de1be5a29ce114b2c2a66c8ca836924f25c63c23f47579f2885685384c87a16e`

ASAR hash matches Wave 1 because Electron main/preload files did not change; renderer/UI lives in extraResources and is covered by build identity + installer hash.

## Protected data proof

Cold backup: `D:\Data\Backups\Premiere316\wave2-pack-uat-20260903T163000Z`

`%APPDATA%\Premiere316` before UAT and after UAT:

- file count: **312 / 312**
- manifest SHA-256: `aa65c30e0e5e57853c16864c00fef2afc853d4967adf302c0b0e7d5bb53c9dc4`

Visual and smoke launched only against temp copies (`premiere316-stage-visual-*`, `premiere316-wave2-smoke-*`). Premiere316 was closed after UAT. No model weight under `D:\AI\Models` was written, moved, renamed, converted, copied, deleted, or loaded automatically.

The Last Reel persist key remains `premiere316-v302-c`. Packaged Research/Screenplay screenshots show the sample picture migrating into the new stage without cloud actions.

## Offline / fail-closed proof

Packaged Screenplay UI (100% native capture):

- Writer: “LM Studio local API is offline. Screenplay generation stays disabled.”
- Story Doctor: “LM Studio local API is offline. Story Doctor stays disabled.”
- `Generate Screenplay` disabled; `Run story doctor` disabled.
- Smoke recorded `servedModels: 0`, `generationEnabled: false`.

S-001 / S-002 / S-003 live draft→critique→scoped revision→approval was **not** run and is **not** waived.

## Gate decision

Wave 2 source, package, isolated offline UAT, shortcut, and user-data identity **PASS**.

Wave 2 product acceptance is **BLOCKED_EXTERNAL_RUNTIME** until the operator already serves **exact Qwen and separate Llama** LM Studio ids on an approved loopback HTTP endpoint and packaged user-triggered draft→critique→scoped revision→approval is proven.

Do **not** open Wave 3. Do **not** treat `lms ps` idle Qwen without reachable `/v1/models` and a Llama pair as S-001.
