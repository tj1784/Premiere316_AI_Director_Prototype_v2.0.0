# PREMIERE316 V3 — PRE-AUDIT BLOCKERS: CONFIGURED MODEL + PHASE REVIEW

Branch: `premiere316-v3`  
Start commit: `41af27de982a6e2ce3ff81aa8ba396c9776aa386`  
Build ID: `p316-20260908180221-c663f2e629b7`  
Status: `FUNCTIONAL_PIPELINE_SOURCE_READY_LM_STUDIO_UAT_BLOCKED`

Do not treat this as GREEN. Packaged LM Studio online UAT was not performed.

## Blocker 1 — no silent non-Llama fallback

`movie-plan-client.ts` no longer uses `ready.find(llama) ?? ready[0]`.

Selection is `selectMoviePlanModel()`:

- Llama served → Build Movie Plan may run.
- No Llama served → fail closed with: `Configured AI model unavailable. Start LM Studio Local API Server and serve the configured Llama model, then Rescan.`
- Qwen served only → blocked unless the user explicitly selected Qwen.
- DeepSeek or any other ready model → blocked.
- `ready[0]` is never used.

## Blocker 2 — phase review does not auto-approve

Default mode (checkbox off): automation may auto-approve Research and Screenplay.

Phase-review mode:

- generate draft
- pause at `waitingForOptionalUserReview`
- no `Automation-approved Research Bible`
- no `approvedVersionId` until the user clicks Approve
- continue only after that approval

Applies to Research, Screenplay, Screenplay QA, Breakdown, Visual Development, Cinematography, Performance, Shots, and Prompt Lab.

## Blocker 3 — anti-placeholder fixtures

Mocked provider tests now require:

- section-specific Research Bible prose
- Xenogears title preservation (not XENOGARS)
- at least two sluglines
- character/action tied to the brief
- QA that references the generated screenplay
- assets extracted from that screenplay/research
- non-empty prompts tied to those shots

Placeholder `Generated section...` output fails closed.

## Blocker 4 — live LM Studio UAT still required

Packaged offline UAT passed (honest fail-closed, no fake draftReady, Assets blocked, no 8188 / cloud / ComfyUI).

Packaged LM Studio **online** UAT was not performed. Status remains blocked.

## Evidence

```text
docs/release/pre-audit-build-movie-plan-blockers.md
screenshots/pre-audit-build-movie-plan-blockers/
  model-selection-tests.json
  phase-review-tests.json
  anti-placeholder-tests.json
  lm-studio-offline-uat.json
  lm-studio-online-uat.json
  test.log
  typecheck.log
  build.log
  electron-pack.log
  no-cloud-no-web-no-comfy-no-8188-proof.json
  m1-plus-regression.json
```
