# R4 verification — 19 September 2026

These are current-run checks, not the historical binder's verification totals.

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run build` | Passed; no DATABASE_URL, so the existing migration script skipped external migrations |
| Focused emotion, R4, voice identity/reconciliation, project persistence, performance, joint graph, Director compiler and preload tests | 128 passed, 0 failed |
| `npm run test:authoring` | 112 authoring tests passed; its included Director suite: 81 passed |
| `git diff --check` | Passed |
| Development renderer, 1280×800 and 390×844 | Visible content; no horizontal overflow, console errors or page errors |
| Built renderer, same sizes | Visible content; no horizontal overflow, console errors or page errors; no divergence from development baseline |
| Existing Cueboard forms | Desktop/mobile screenshots visually inspected; labeled selects/fields, keyboard Tab, hierarchy/intensity selection, scope editing and manual version save exercised |
| Isolated sample versions | Saved separate line objectives; switching lines recovered the correct value; both versions recovered on reload. Coverage added by legacy normalization made those versions stale as expected. A fresh version saved after normalization remained editable/applicable after reload. Explicit apply and unapply exercised. |
| Actual Electron runtime | Existing `desktop/main.mjs` launched using an isolated QA userData directory; renderer visible, preload available, buildInfo IPC returned app version 3.0.2 and DEV SERVER; no Electron page errors observed |

The seven R4 regressions cover catalog completeness, quiet level-seven grief, beat permission ceilings, Unicode exact-dialogue serializers, medium/wide framing and ambiguous coverage, H3 sound/score preservation, separate displayed state, regional trace and silent voice budgets. Existing focused tests cover identity/member approval, hashes, tombstones, stale tickets, late responses and saved-output graph validation.

The Linux-only `preview:restart` helper refused this Windows environment (`no /proc`). The existing `npm run preview -- --host 127.0.0.1 --port 8081` script served the fresh production build instead. The first smoke screenshot caught the normal “Opening your pictures…” loading screen; rerunning with `BROWSER_SMOKE_READY_SELECTOR='nav[aria-label="Pipeline"]'` verified the fully loaded application. No source change was necessary for either test-harness issue.

The isolated UI fixture initially exceeded browser localStorage quota after the application's normal hydration merged bundled movies into the test storage. The QA adapter was narrowed to its one synthetic picture; subsequent save/reload checks succeeded. This adapter is verification-only, not application persistence. The real application retains its existing IndexedDB/project-folder storage and its passing persistence tests.

Both smoke passes report the pre-existing platform share-card placeholder note. Branding is outside this Cueboard-only implementation; no shell or branding redesign was performed.

## Evidence

- `artifacts/cueboard-r4-focused.log`
- `artifacts/cueboard-r4-authoring.log`
- `artifacts/cueboard-r4-typecheck.log`
- `artifacts/cueboard-r4-build.log`
- `screenshots/cueboard-r4-dev.json`, desktop/mobile PNGs
- `screenshots/cueboard-r4-built.json`, desktop/mobile PNGs
- `screenshots/cueboard-r4-form.png`, `cueboard-r4-form-mobile.png`
- `screenshots/cueboard-r4-electron.png`
- `artifacts/cueboard-electron.log`, `cueboard-electron-error.log`

No live writer, model loading, native video generation, separate dialogue TTS, packaged-installer rebuild or deployment was run. H3 speech-tag rendering and audiovisual quality remain inference-unverified; LTX prompt preview does not authorize voice-reference execution. See IMPLEMENTATION.md for the scoped rule register and retained engine/continuity boundaries.
