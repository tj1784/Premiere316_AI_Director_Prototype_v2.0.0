# Premiere316 V3 — 64-Agent Master Orchestration Package

Files:

- `PREMIERE316_V3_64_AGENT_MASTER_ORCHESTRATION_PROMPT.md`
- `PREMIERE316_V3_64_AGENT_ROSTER.md`
- `PREMIERE316_V3_STAGE_LAYOUT_MATRIX.md`
- `PREMIERE316_V3_TASK_MATRIX.json`

Use the main prompt as the master coordinator instruction. Attach or make the other files
available to the orchestrator.

The package defines exactly 64 logical roles, but it deliberately prevents 64 agents from
editing the same workspace simultaneously. It uses pods, worktrees/file leases, delivery
waves, integration gates, and packaged-Electron acceptance.
