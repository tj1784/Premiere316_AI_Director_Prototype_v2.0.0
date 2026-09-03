# Wave 1 Gate — Stage-specific UI/UX cleanup

Status: **GREEN**

Canonical product: **Premiere316.exe**

Packaged build: **p316-20260903111905-59efdd5cbadc**
Renderer source hash: `59efdd5cbadc35e1862d0c05c9fe54bc4e73dfeec824f35a982f5909c89a689c`

## Scope delivered

- Added one declarative `StageLayoutPolicy` covering every implemented stage.
- Removed global generation controls and generic Rewrite leakage.
- Generate exclusively owns its generation Bin and Inspector.
- Stitch exclusively owns its Media Bin, Clip Inspector, and timeline.
- Removed hosted xAI text, video, voice, score, and director-chat execution paths.
- Retained only user-triggered local still generation and loopback LM Studio screenplay generation.
- Added responsive stage navigation, focus-trapped panel drawers, and 100–200% zoom-safe layouts.
- Updated packaged UAT harnesses to use semantic controls and Electron `webContents.capturePage()` so screenshots represent the complete native window at page zoom.

## Source gates

| Gate | Result |
|---|---|
| `npm test` | **PASS — 205/205** |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `git diff --check` | **PASS** |
| Hosted inference scan | **PASS — no direct xAI endpoint/key references in `src`** |
| Electron preload/security | **PASS — 10/10** |
| Electron zoom unit gate | **PASS — 5/5** |

## Packaged Windows gates

| Gate | Result |
|---|---|
| Renderer mode | **PACKAGED DIST** |
| Build identity | **p316-20260903111905-59efdd5cbadc** |
| Packaged smoke | **PASS** |
| Stage visual matrix | **PASS — 20/20** (10 stages at 100% and 150%) |
| Visual policy violations | **0** |
| Console/page errors | **0 / 0** |
| Manual screenshot inspection | **PASS — all 20 captures** |
| LM Studio offline behavior | **PASS — starts normally and fails closed** |
| Native image capability gate | **PASS — unavailable configurations remain disabled** |
| Timeline visibility | **PASS — Stitch only** |
| Start Menu shortcut | **PASS — targets canonical unpacked executable** |

Screenshots and machine-readable reports are written under `screenshots/stage-visual/` and `screenshots/premiere316-desktop-smoke.json`.

## Artifact hashes

- `Premiere316.exe`: `6cce7b43b2a90b26dce57f89349726f290129618f6bef125b3facefe67d9f0ba`
- `resources/app.asar`: `4be85fb9bab01511f9ee1a2577452d8d8902dc96c4cf2189abdc3159c9c90153`
- `Premiere316-Setup.exe`: `3bfb3e5462ce4b484fe09e4a70b95caf0ff3753b82de799ec112539056185dcb`

## Protected data proof

The final packaged smoke ran behind a cold profile backup. The `%APPDATA%/Premiere316` tree contained 303 files before and after; every relative path, byte count, and SHA-256 matched. Manifest hash before and after:

`d0e3dabf5b1837decf2689b50b7f55fd14aa5a35598c049f2c8caa05b57dac99`

The previously extracted `premiere316-v302-c` payload remains the protected **The Last Reel** value with SHA-256:

`2621ac10c50b925aa2081971fdc3858364d60caaa74ae866caf5da7ce4947b8c`

No model weight under `D:/AI/Models` was written, moved, renamed, converted, copied, deleted, or loaded automatically.

## Gate decision

Wave 1 is frozen green. Wave 2 may open under a new file-lease set. Real model-backed acceptance remains fail-closed until the required exact operator-served LM Studio model IDs or verified native media adapters are available; no substitute provider is permitted.
