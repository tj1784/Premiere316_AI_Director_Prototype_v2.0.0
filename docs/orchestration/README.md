# Premiere316 V3 orchestration control plane

Canonical execution profile: **64 is the new black** (`64-is-the-new-black`).

- `spec/` is the integrity-preserved orchestration package supplied by the user.
- `baseline-audit.json` freezes the verified source, tests, packaged app, persistent data, model inventory, and rollback evidence.
- `agent-roster-state.json` maps all 64 logical roles to one root, six xhigh captains, 54 medium specialists, and three independent medium auditors.
- `file-leases.json` is the exclusive mutation registry. A path has one writer at a time.
- `task-status.json` is the live backlog derived from the supplied task matrix.
- `wave-status.json` is the gate ledger. Feature work cannot cross a red or blocked gate.

Protected baseline tag: `protected-baseline-p316-20260903075925-1b93dd668ab3`.
External immutable checkpoint: see `baseline-audit.json`; model weights and user data are never committed.

## Wave ledger (live)

- Waves 0–4: **GREEN**
- Wave 5 overall: **PARTIAL** — 5A GREEN / 5B BLOCKED (`docs/release/wave5-gate.md`)
- Wave 5A: **GREEN** — app-side video architecture, fail-closed H3/LTX, packaged verification (`docs/release/wave5a-gate.md`, tag `wave5a-p316-20260907141538-8286ff6d5eb0`)
- Wave 5B: **BLOCKED** — real non-Comfy H3/LTX video runtime (`docs/release/wave5b-blockers.md`)
- Wave 6: **PARTIAL** — 6A audio architecture GREEN / 6B real TTS/Music3 BLOCKED (`docs/release/wave6-gate.md`)
- Wave 7: **PARTIAL** — 7A import/timeline/readiness/paper export GREEN / 7B native film + live FFmpeg master + SQLite BLOCKED (`docs/release/wave7-gate.md`)
- Wave 8: **PARTIAL** — 8A lifecycle/readiness/guided path GREEN / 8B autonomous crew BLOCKED (`docs/release/wave8-gate.md`)
