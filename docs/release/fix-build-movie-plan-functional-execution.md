# Fix Build Movie Plan functional execution

Branch: `premiere316-v3`
Build ID: `p316-20260908173500-a44903bd07d6`
Status: `FUNCTIONAL_PIPELINE_SOURCE_READY_LM_STUDIO_UAT_BLOCKED`

## What changed

`Build Movie Plan` is no longer a skeleton state transition.

- Offline / no served model: every internal phase is `failed`, next touchpoint stays Intake, no fake Research Bible, no fake screenplay, no `draftReady`.
- Online (configured LM Studio model loaded): `executeMoviePlan()` calls the model for Research, Screenplay, a separate QA context, breakdown/assets, visual/cinematography/performance/shots, then compiles Asset Gate prompts.
- Research **Build Research Draft** uses the same provider path.
- Assets Gate shows extracted assets after success, or:

```text
Movie plan did not complete.
Assets were not generated.
```

## Live UAT

Packaged offline UAT passed.

Packaged LM Studio **online** UAT was not performed in this environment. Do not treat this as complete GREEN.

## Evidence

```text
docs/release/fix-build-movie-plan-functional-execution.md
screenshots/fix-build-movie-plan-functional-execution/
```
