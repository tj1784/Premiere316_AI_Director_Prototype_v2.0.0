# Wave 2 Gate — Research Room and Screenplay 2.0

Status: **BLOCKED_EXTERNAL_RUNTIME** (pending-runtime repair checkpoint)

Canonical product: **Premiere316.exe**

Packaged build: **p316-20260903170432-d400d191ba52**
Renderer source hash: `d400d191ba52cc35f69f521550639db010f153320ee951784a341ac34d6278ab`

Prior pending-runtime commit: `28c60f6`. This repair checkpoint includes A64 source repairs plus A04 isolated repackage.

Wave 3 is **not** opened. No green tag.

## Scope delivered (source + packaged offline)

- New StageId `"research"` after Intake. New pictures land Intake→Research. Persist key remains `premiere316-v302-c`.
- Additive Picture Research Bible: local-only default, web-assisted stub with no network, sources/quotes/A–D/locators/disputes, social-world + cinematic expression, cinematography research, append-only versions, approve + delta.
- Research workspace is stage-owned (no generation rails, no timeline, no shell Rewrite).
- Screenplay generation stays disabled until Research is approved **and** an exact currently served Qwen id is pinned. Family/substring matches are rejected.
- Story Doctor requires a separate exact currently served Llama id; critique-first; Fountain changes only via explicit scoped revision.
- LM Studio discovery never treats `:8080` as a candidate. Completion POST is refused unless native listing still shows the exact served ID loaded.
- Packaged UAT at native 100% and 150% walked Intake through Export, including Research and Screenplay 2.0.
- Isolated user-data directories were used for both visual and smoke UAT. Live `%APPDATA%\Premiere316` was cold-backed and identity-verified.

## Source gates

| Gate | Result |
|---|---|
| `npm test` | **PASS — 227/227** (19 script/desktop + 208 typed) |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `git diff --check` | **PASS** |
| Electron preload/security | **PASS — 10/10** |
| Electron zoom unit gate | **PASS — 5/5** |
| A64 source review | **PASS** (`blockerKind: none`) |

## Packaged Windows gates

| Gate | Result |
|---|---|
| Renderer mode | **PACKAGED DIST** |
| Build identity | **p316-20260903170432-d400d191ba52** |
| Packaged smoke | **PASS — isolated profile; research gate; pin UI; no :8080; no completion POST** |
| Stage visual matrix | **PASS — 22/22** (11 stages at 100% and 150%, native `capturePage()` 1424×861) |
| Visual policy violations | **0** |
| Console/page errors | **0 / 0** |
| Manual screenshot inspection | **PASS — Research and Screenplay 100/150** |
| LM Studio HTTP | **UNREACHABLE** `http://127.0.0.1:1234` timed out; app fail-closed |
| Exact served Qwen + Llama pair | **ABSENT** — `lms ps` showed idle `qwen2.5-72b-instruct` only; no Llama; HTTP API not serving. LMS was **not** started and no model was loaded. |
| Native image capability gate | **PASS — unavailable configurations remain disabled** |
| Timeline visibility | **PASS — Stitch only** |
| Start Menu shortcut | **PASS —** `C:\Users\teeja\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Premiere316.lnk` → `D:\Projects\Premiere316_v3\dist-desktop\win-unpacked\Premiere316.exe` |

Machine-readable reports: `screenshots/stage-visual/report.json`, `screenshots/premiere316-desktop-smoke.json`.

## Artifact hashes

- `Premiere316.exe`: `6cce7b43b2a90b26dce57f89349726f290129618f6bef125b3facefe67d9f0ba`
- `resources/app.asar`: `4be85fb9bab01511f9ee1a2577452d8d8902dc96c4cf2189abdc3159c9c90153`
- `Premiere316-Setup.exe`: `3562ad7274293e298bd330c8be426860edce2d3d5ab9f1f80d39461e2ab71daa`

ASAR hash is unchanged because Electron main/preload files did not change; renderer/UI lives in extraResources and is covered by build identity + installer hash.

## Protected data proof

Cold backup: `D:\Data\Backups\Premiere316\wave2-a64-repack-20260903T170400Z`

`%APPDATA%\Premiere316` before UAT and after UAT:

- file count: **312 / 312**
- manifest SHA-256: `aa65c30e0e5e57853c16864c00fef2afc853d4967adf302c0b0e7d5bb53c9dc4`

Visual and smoke launched only against temp copies. Premiere316 was closed after UAT. No model weight under `D:\AI\Models` was written, moved, renamed, converted, copied, deleted, or loaded automatically.

## Offline / fail-closed proof

Packaged Screenplay UI (100% native capture + isolated smoke):

- Unapproved research: “Approve Picture Research before generating a screenplay.” Generate disabled.
- After isolated Approve research: Generate still disabled; “LM Studio local API is offline. Screenplay generation stays disabled.”
- Writer: “Pin exact served Qwen ID” / “No writer ID pinned.”
- Story Doctor: “Pin exact served Llama ID” / “No Story Doctor ID pinned.” / “LM Studio local API is offline. Story Doctor stays disabled.”
- `Run story doctor` and `Apply scoped revision` disabled.
- Renderer network: probed8080=0, completionPosts=0.
- Smoke recorded `servedModels: 0`, `generationEnabled: false`.

S-001 / S-002 / S-003 live draft→critique→scoped revision→approval was **not** run and is **not** waived.

## Gate decision

Wave 2 source, package, isolated offline UAT, shortcut, and user-data identity **PASS**.

Wave 2 product acceptance is **BLOCKED_EXTERNAL_RUNTIME** until the operator already serves **exact Qwen and separate Llama** LM Studio ids on an approved loopback HTTP endpoint and packaged user-triggered draft→critique→scoped revision→approval is proven.

Do **not** open Wave 3. Do **not** treat idle `lms ps` Qwen without reachable `/v1/models` and a Llama pair as S-001.
