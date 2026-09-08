# Final pre-audit: optional Intake and packaged LM Studio

- Branch: `premiere316-v3`
- Start commit: `bd254dfe30889851811ac50b12ec24daf756b484`
- Build ID: `p316-20260908185301-6e6cab548fb4`
- Status: **NOT GREEN**. Live run results are recorded in the evidence below.

## Intake change

The default Intake shows the movie idea, Build Movie Plan, and the phase-review checkbox. Source mode, Title, Logline, Premise, Treatment, Existing screenplay, Source material, Source passages, Genre, Runtime, Tone, and Director notes are inside a native, initially closed **Optional details** disclosure. Existing source-specific conditions and field values are preserved.

The user additionally authorized the New Picture entry path during this cleanup. New Picture now creates a blank local picture and opens this Intake directly, with no required title form. Source type remains selectable inside Optional details. No new product modes, approval gates, or engine workers were introduced.

The user then requested visibility into what the model is doing. Build Movie Plan now displays the current phase and its purpose, exact served model, elapsed time, character count, and live draft output. Earlier phases can be selected while a run continues. The server transports the provider's ordinary output text as NDJSON; the UI receives it before generation finishes. Hidden reasoning channels are not forwarded. Stream errors and incomplete responses cannot be accepted as completed drafts. This changes the response transport, not model selection or approval semantics.

Writing and QA are **sequential**, distinct requests against the same Llama model. QA uses its own context after the screenplay exists. There are not two simultaneously running Llama agents; the live runtime has one inference slot. This was explicitly clarified when the user asked for confirmation.

## Verification

- `npm test`: **373 passed**, zero failed (49 script/desktop tests plus 324 TypeScript tests).
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run electron:pack`: passed, including the packaged runtime audit and Windows installer.
- Dev and production browser smoke: desktop and mobile render, clean console, no horizontal overflow, no baseline divergence.
- Browser and packaged Intake checks: only one visible text area by default; optional fields stay collapsed; all five source types remain available; edits survive collapse, source switching, and reload.
- M1-PLUS packaged regression: three canonical imported clips plus audio exported to a 30-second film; FFprobe verifies duration and audio. Existing regression files were not overwritten.
- Model-selection, phase-review, anti-placeholder, and offline tests remain passing. Added release-evidence tests reject GREEN for skipped, offline-only, incomplete, or non-packaged runs.
- Stream tests verify early output, provider failures, truncated transport, split UTF-8 frames, and cancellation. Real packaged UAT verifies output is visible before the Build Movie Plan operation completes; see `live-model-activity.png`. The same live panel was resized to 390×844, visually checked, and restored without interrupting generation; no horizontal overflow was present.

The optional browser CLI was unavailable twice, so Playwright was used. The Linux-only `preview:restart` helper rejected this Windows environment; `npm run preview` served the production output for the same baseline smoke check. The existing missing custom share-card note is unchanged; no branding redesign was included.

## Live UAT and boundaries

The LM Studio local API was already running, with no loaded models. Llama 3.3 70B Instruct was installed locally. The first live packaged attempt used four inference slots and generated about 1.9 tokens/second. It was deliberately interrupted to reload the same model with one slot, full GPU offload, and a 16,384-token context. That interrupted attempt is retained separately and is not counted as a completed UAT.

The second attempt was deliberately stopped to rebuild with the user-requested live activity view. The final attempt uses that new packaged build and the same loaded Llama model. Both earlier interrupted attempts are retained and excluded from the final attempt's request counts.

The final packaged online UAT **ran to completion and failed**, rather than being skipped or interrupted. It made exactly two completion requests to `llama-3.3-70b-instruct`, with no silent fallback. Research was generated live and accepted as `draftReady`. Screenplay output streamed live, but its JSON contained unescaped newlines in the `fountain` string and was rejected: `Bad control character in string literal in JSON at position 56 (line 3 column 16)`. No screenplay draft was accepted. The separate QA request and asset extraction never ran; all subsequent phases correctly remain blocked. The live display proves streaming visibility, not successful generation or concurrent QA.

Research content also requires audit: some sections describe future research rather than completed findings, and purported source quotes were not independently verified. Acceptance by the current parser is not evidence of factual or creative quality.

Remaining blockers are the malformed screenplay response, the runtime-default issue below, and the external branding request that prevents strict no-web proof. **No GREEN tag was created or pushed.** These failures are preserved for follow-up rather than hidden by retries or synthetic artifacts.

The offline/no-served-model packaged run is functionally correct: no Research, Screenplay, QA, or assets appear; no `draftReady` phase appears; Assets remains blocked. Its strict network result is not a pass because the existing packaged renderer requests `https://grok.com/grok-app-builder/extensions.js`.

The live request also exposes an existing intake-default problem: a two-minute sentence reaches Research with `runtimeMinutes: 90`. The default runtime wins over the parsed sentence in the existing pipeline. This is recorded as an audit blocker; no pipeline change was included in this UX cleanup.

The network evidence combines renderer request capture, real LM Studio server logs, and existing source/package guards. It is not an OS-wide packet capture and does not independently trace every server-side egress path. No zero-web claim is made: the branding extension request is explicitly listed. Native H3/LTX/TTS/Music3 were not started.

## Evidence

All current artifacts are under `screenshots/final-pre-audit-intake-and-lmstudio/`:

- `intake-default-collapsed.png`, `intake-optional-expanded.png`, `intake-mobile.png`
- `live-model-activity.png`, `live-model-activity-mobile.png`, `lm-studio-online-result.png`
- `intake-browser-uat.json`
- `lm-studio-online-uat.json`, `lm-studio-offline-uat.json`
- `online-picture.json`, `offline-picture.json`
- `lm-studio-server.jsonl`, `lm-studio-model.jsonl`, renderer network JSON files
- `no-cloud-no-web-no-comfy-no-8188-proof.json`
- `test.log`, `typecheck.log`, `build.log`, `electron-pack.log`
- `dev.json`, `built.json`, associated desktop/mobile screenshots
- `m1-plus/export-uat.json`, `m1-plus/ffprobe-output.json`, `m1-plus-regression.log`
- `attempt-1-four-slots/` preserves the interrupted first attempt.
- `attempt-2-before-live-view/` preserves the attempt stopped for the requested UI update.

The reproducible harness is `scripts/final-pre-audit-uat.mjs` (`browser`, `offline`, or `online`). It launches a fresh isolated profile and clicks New Picture → enters one sentence → Build Movie Plan. Run `lms log stream --source server --json` into the evidence server log before packaged UAT. It does not mock provider responses or seed generated artifacts. `scripts/summarize-pre-audit-evidence.mjs` combines the preserved provider logs with the recorded application result. No GREEN tag may be pushed while the live result or strict no-web proof fails.
