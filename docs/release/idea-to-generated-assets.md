# One idea through generated asset images

Start: `74a02be45330d08939c76e0329bfd08519f51445`, branch `premiere316-v3`.

The user expanded the cleanup into fixing the live failures and explicitly requested actual generated asset images. Work and evidence are isolated under `screenshots/idea-to-generated-assets/`; earlier failed evidence remains unchanged.

## Changes

- Every movie-plan model phase sends an explicit JSON schema through LM Studio's structured-output API. JSON parsing remains strict; malformed or truncated results cannot be saved as successful drafts. This follows [LM Studio's structured-output contract](https://lmstudio.ai/docs/developer/openai-compat/structured-output).
- Durations stated in the idea override untouched Intake defaults. A manual Runtime edit takes precedence and records its origin. Both the picture and its Intake carry the resolved duration. Numeric and common written minute/second durations are understood.
- Research requests short completed development decisions and refuses fabricated source quotations. Only quotes found verbatim in supplied source text may be appended to the source ledger. Source evidence and fidelity constraints reach the screenplay directly. Future promises to research are rejected.
- Thinking and screenplay QA are separate optional Intake controls, both off by default at the user's request. Thinking off sends `reasoning_effort: none` and `chat_template_kwargs.enable_thinking: false`, verified against the named local Qwen model with zero reasoning tokens in its probe response. QA off issues no critic request and records an explicit skipped phase, with no QA report fabricated.
- When QA is enabled, it remains a separate sequential context. Required corrections trigger one bounded writer revision and another QA pass. Unresolved required revisions block downstream work and retain the report. Optional phase review still pauses for approval. A failed revision updates the previously completed writer phase to failed.
- The user-selected default writer is `qwen3.6-40b-claude-4.6-opus-deckard-heretic-uncensored-thinking-neo-code-di-imatrix-max`, loaded from the user's `D:\AI\Models\LMStudio` catalog (Q4_K_S, 24,644,759,136 bytes). Explicit picture pins still take precedence; no arbitrary model fallback is introduced.
- Asset, performance, and shot schemas constrain scene numbers to an enum of the actual parsed screenplay scenes. The model also receives the exact numbered scene index. Invalid references remain errors instead of being silently reassigned.
- Extracted assets retain their actual screenplay scene links. Performance output becomes saved acting direction. Generated camera and coverage plans are bound to the generated shots so image preparation has actual plans to review.
- Assets includes a direct link to specification preparation. The existing specification, authority, prepared-approval, generation, and image-review controls remain in use.
- After native Generate confirmation, the app releases the exact movie-plan writer model and verifies that it is unloaded before starting image inference. It does not unload arbitrary other models or silently load another text model.
- Desktop startup uses local visible Grok attribution, eliminating its automatic external script request. The web build retains the platform extension. This desktop-only adjustment implements the user's explicit no-web requirement.
- Discovery allows five seconds for the local server rather than failing after 1.5 seconds.
- Shot grammar requires 18 ten-second shots for the 180-second brief. Frame-exact duration allocation runs before camera/performance workspaces are seeded; the saved shot and canonical performance totals both equal 180 seconds.
- Native image resolution supports the existing flat vault and organized family folders while retaining exact size/hash checks. Ready FLUX.1 is preferred over an unavailable FLUX.2. The current FLUX.2 VAE still fails its expected hash and remains blocked.
- Prepared approvals are serialized with sealing/evaluation so concurrent asynchronous saves cannot overwrite another asset's approved root.
- Visual inspection rejected the first two generated images for modern details. The FLUX.1 T5 call differed from BFL's installed official `HFEmbedder`: it supplied a padding attention mask. The worker now passes `attention_mask=None`, matching the conditioning used by the official implementation. A CPU-only regression test executes the actual encoding function with instrumented encoders.

## Verification record

The first retry failed at local model discovery before any inference request. A subsequent product rescan found the loaded Llama; the failed run is retained in `discovery-timeout/`. It is excluded from live generation success claims.

The subsequent Llama run produced valid research and screenplay but was stopped after the user rejected the assistant-invented Xenogears premise. Its evidence is archived under `rejected-invented-brief/` and is not successful evidence.

The user replaced the story with a three-minute Moses/Red Sea sequence and selected Qwen. The live test is now under `screenshots/moses-qwen-no-thinking/`, using supplied public-domain Exodus 14 excerpts, thinking off, QA off, one inference slot, and visible streaming in the packaged app. The first Qwen attempt stopped on an invalid sixth scene reference, preserved in `invalid-scene-reference/`. Qwen generated approximately 36 tokens/second versus the earlier Llama's approximately 3. No provider responses are mocked or generated artifacts seeded. The image harness reopens the persisted project and operates existing product controls.

The live packaged plan passed with seven Qwen calls, thinking off, screenplay QA explicitly skipped, visible streaming, and 18 shots totaling 180 seconds. Planning build: `p316-20260908200835-a5f15ca371b1`. The first image run completed with real PNGs and native receipts, but its visual result was rejected; that evidence is retained under `rejected-visuals/`. Corrected image results are recorded separately below when verified.

`npm test` passed 382 tests (50 script/desktop and 332 TypeScript); typecheck and production packaging passed. After the encoding change, the 29 native policy/residency tests and `scripts/flux-conditioning.test.py` passed. Desktop/mobile dev and built smoke checks rendered content without console errors or horizontal overflow; screenshots were inspected. The utility retains the platform's default share card (the smoke tool emits a non-failing brand note).

Corrected image UAT passed in build `p316-20260908202917-dcc1cec36743`, reopening the actual generated plan and using specification, camera, authority, prepared approval, and native Generate controls. Two new 512×512 PNGs were produced by the app-owned FLUX.1 worker, with distinct hashes, provenance and ledger receipts. Moses: `4432922188717427b6accc40` (hash prefix); shoreline: `2f81c8f5e895b02c0a902bc1` (hash prefix). Refer to `images-uat.json` for exact complete hashes. Visual inspection found a clothed bearded figure and an undeveloped night shoreline, correcting the conspicuous modern details in the first run. These remain NEEDS_REVIEW iterations, not canonical approvals or proof of historical costume accuracy. Only two assets were exercised; the whole film's required assets are not complete.

Final package `p316-20260908203320-650d59fdf8b0` adds only clearer verified-model status copy after that successful image run. It was built and browser-smoked separately; the evidence does not imply the entire generation test ran again under this final build ID. No GREEN tag: screenplay QA was intentionally off, and the requested finished video remains incomplete.

## Evidence scope

Renderer request logs, LM Studio request/output logs, product state, generated media, provenance sidecars, and native generation receipts are preserved. Source/package checks supplement them. Request logs are not an OS-wide continuous packet capture and must not be described as one. The latest user request includes an actual three-minute video; the existing H3/LTX video workers currently return `ADAPTER_UNAVAILABLE` and cannot generate motion. Image generation uses the existing native FLUX adapter. A successful image test must not be represented as a finished video or as passing the older mandatory-QA release contract.
