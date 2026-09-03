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
