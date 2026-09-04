# Wave 3 Gate — package pass awaiting audit

Status: `PACKAGE_PASS_AWAITING_AUDIT`

This is the resumed A04 package gate after the paused checkpoint `016826eaf74f0f77c4ea7f31a297078537dd66d3`. Wave 3 is **not green** until independent A07/A08/A64 audits pass. Wave 4 remains closed. No Wave 3 green tag was created.

## Package identity

- Build ID: `p316-20260903203247-955eb4a6feaa`
- Renderer source hash: `955eb4a6feaab1ee48755c5558527a4292f080453c0cee1ae5172be0e42a556a`
- Mode: `PACKAGED DIST`
- Executable: `dist-desktop/win-unpacked/Premiere316.exe`
- App ASAR: `dist-desktop/win-unpacked/resources/app.asar`
- Packaged UI entry: `dist-desktop/win-unpacked/resources/ui/server/index.mjs`
- Installer: `dist-desktop/Premiere316-Setup.exe`

The packaged `resources/build-info.json` matches `desktop/build-info.json` and the recomputed renderer source hash. Electron `Premiere316.exe` and `app.asar` remained stable from the Wave 2 package while the external packaged `resources/ui` tree carries the Wave 3 UI; the package proof therefore includes both build-info/source identity and UI-entry hashes.

## Artifact hashes

- `Premiere316.exe` SHA-256: `06b87db5bb7864e2eff5ecd37905b94ececa41a4ee0f0b09b4bbbbcb42428052`
- `resources/app.asar` SHA-256: `70682644bd66ed9b8a868671fb0f914cafe414018ab09f35fda3712f2b97001d`
- `Premiere316-Setup.exe` SHA-256: `baca9115b6bc873c23f724427ac866ab2d688f4f5b12580a943908e2e839da41`
- `resources/build-info.json` SHA-256: `1317c8d583b460599487cc3246dfc6ef33465f7067ffee1a8c54f9b0ed68adff`
- `resources/ui/server/index.mjs` SHA-256: `31281952b47d4d53157156a6f1279f64141a3e241de0304d76255618fc44a332`
- `resources/ui/server/_ssr/routes-DuA6iHmt.mjs` SHA-256: `76a902f0800941cae6f1acb84b677872f25f188834c9640926bf1847bff7b294`

## Source gates

| Gate | Result |
|---|---|
| `npm test` | **PASS — 266/266** (26 script/desktop + 240 typed) |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS**; `DATABASE_URL` unset migration skip expected |
| `git diff --check` | **PASS**; CRLF normalization warnings only |
| Package audit | **PASS** — required ASAR modules and external resources present |
| Recomputed source identity | **PASS** — current source hash equals packaged renderer source hash |

## Packaged Windows gates

| Gate | Result |
|---|---|
| Serialized `node scripts/desktop-smoke.mjs` | **PASS** after harness-only report fix |
| Smoke build identity | **PASS** — `p316-20260903203247-955eb4a6feaa`, `PACKAGED DIST` |
| Smoke content/console | **PASS** — visible final capture, zero console/page errors |
| Smoke 13-stage navigation | **PASS** — report records stages 01 Intake through 13 Export |
| Smoke Llama/Qwen fail-closed state | **PASS** — no model loaded; Llama default and Qwen optional second-opinion UI visible; generation/QA disabled; completion POSTs 0 |
| Smoke network | **PASS** — forbidden `:8080` probes 0 |
| Existing native stage matrix | **PASS** — 26/26 captures for 13 stages at 100% and 150%, zero violations |
| Existing Wave 3 visible-control UAT | **PASS** — packaged build identity matches; approved screenplay → breakdown → Inventory 2.0 → Visual Development → Cinematography → prepared assets |
| Start Menu shortcut | **PASS** — per-user shortcut targets `D:\Projects\Premiere316_v3\dist-desktop\win-unpacked\Premiere316.exe` |

Machine-readable evidence:

- `screenshots/premiere316-desktop-smoke.json`
- `screenshots/premiere316-windows-final.png`
- `screenshots/stage-visual/report.json`
- `screenshots/wave3-uat/report.json`
- `screenshots/wave3-resume/live-data-backup-manifest.json`
- `screenshots/wave3-resume/live-data-post.json`
- `screenshots/wave3-resume/robocopy-live-vs-backup.txt`

Representative screenshots manually inspected: Inventory 100/150, Visual Development 100/150, Cinematography 100/150, Wave 3 prepared-assets UAT, and the final desktop-smoke capture. They show visible packaged UI with the 13-stage hierarchy and no blank stage.

## Data/process proof

Fresh cold backup: `D:\Data\Backups\Premiere316\wave3-resume-a04-20260904T045316Z`

`%APPDATA%\Premiere316` compared against the fresh backup after all serialized package checks:

- file count: **312 / 312**
- manifest SHA-256: `de887012c3b17249f89bad318207fa1e7997642c287eff58c14228bff19143f8` / `de887012c3b17249f89bad318207fa1e7997642c287eff58c14228bff19143f8`

All isolated temp profiles matching `premiere316-wave2-smoke-*`, `premiere316-stage-visual-*`, and `premiere316-wave3-uat-*` were deleted after verification. Final Premiere316/Electron process check returned `[]`. `lms ps --json` returned `[]`; no local model inference, model/server lifecycle action, media generation, ComfyUI action, cloud call, database/auth addition, download/conversion, or `D:\AI\Models` mutation was performed.

## Gate decision

Wave 3 source, package identity, serialized packaged smoke, existing 26-capture native visual matrix, existing Wave 3 packaged visible-control UAT, Start Menu shortcut, live-data safety, process cleanup, secure Electron, and 100–200% zoom checks **PASS**.

Wave 3 status is **PACKAGE_PASS_AWAITING_AUDIT**. Do **not** open Wave 4 and do **not** create a Wave 3 green tag until independent A07/A08/A64 audits accept this package evidence.
