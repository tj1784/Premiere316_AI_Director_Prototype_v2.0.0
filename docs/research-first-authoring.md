# Research-first authoring and the Prodigal Son import

This branch brings the automatic movie plan and screenplay editor into line with the process used to create the delivered Prodigal Son screenplay and visual inventory.

## Department order

1. Preserve the full intake: format, duration, source, permitted dramatization, emotional priorities, visual constraints and director instructions.
2. Collect source contents before historical drafting. Pasted text remains labeled supplied evidence. Retrieved documents retain their actual URL, excerpt and retrieval date. A locator or search result alone is not evidence. Public research respects explicit no-browsing instructions; failed retrieval offers a source-text fallback.
3. Complete the research bible, distinguishing source text, historical evidence, reconstruction, disputed interpretation and dramatic invention.
4. Write the complete Fountain screenplay. Each newly generated scene has a positive `[[Duration: N]]` note. The complete timing plan must match the requested duration before inventory extraction. Timing is an editorial estimate, not measured playback.
5. Review the finished screenplay in separate source/character and material-culture/continuity contexts. Resolve consequential findings and review again. New projects enable this by default; explicit QA opt-outs remain honored and are labeled as skipped.
6. Extract the complete inventory from the final screenplay in six-scene batches. Merge shared identities, retain state variants, link actual scene IDs, and preserve continuity locks and required reference views. There is no 60-asset ceiling.
7. Develop the visual direction from the completed screenplay, research and inventory.
8. Develop cinematography from that visual handoff and scene timing.
9. Write asset prompts from the actual target, linked scenes, evidence, related identities and state requirements. Respect saved user prompt edits.
10. Generate available canonical root images. Dependent states wait for approved parent images and carry the actual approved media revision into their references.
11. Approve canonical assets before first/last-frame generation. Only actual current scene-related approved images count.
12. Approve the actual first/last-frame pair before native video generation. Existing explicit imported-video waivers remain separate.

Model contexts for the two reviews are independent calls, not a claim that distinct human reviewers or different model weights performed them. The existing optional department-review controls remain available. Completed phases and retrieved evidence are checkpointed so a later failure does not discard completed work.

## Imported picture

The picture ID is `pic_prodigal_son_20260909`. It installs once into existing and new picture collections. Existing pictures and user edits survive hydration. An installed-picture marker also prevents a deliberately deleted bundled picture from reappearing.

| Preserved content | Count |
| --- | ---: |
| Narrative scenes | 22 |
| Separately timed credits entry | 1 |
| Planning duration | 1,800 seconds |
| Asset records | 129 |
| Scene–asset uses | 539 |
| Continuity rules | 29 |

The Fountain text, original scene IDs, source offsets, timing metadata, parent dependencies and full source records are preserved. The accepted screenplay is an imported editorial snapshot. It does not claim local-model generation or application QA telemetry. Research is sourced imported work awaiting application review. Visual specifications and all media approvals remain pending.

Empty downstream workspaces prevent hydration from inventing palettes, shot lists, cinematography or performance notes. Four inventory records describe editable graphics or reuse of earlier scenes; they are retained as production records rather than sent to an image generator.

The original Fountain, Word screenplay, Excel inventory, research notes, complete ZIP and JSON data are served from `public/pictures/prodigal-son/`. Package download links appear in Screenplay, Inventory and Assets. Tests verify the originals against their SHA-256 checksums.

## Verification

Run `npm test`, `npm run typecheck` and `npm run build`. `npm run test:authoring` covers the new source collector, authoring contract, complete import and asset prompt context. Core pipeline tests cover a 129-asset extraction, batch merging, separate clean reviews, invalid timing, checkpoints and source gating. Media-gate tests cover dangling, stale and scene-mismatched approvals.

Browser verification covers opening the picture, inventory counts, complete screenplay and credits, all package download checksums, persistence of a user edit after reload, and mobile layout. Local model generation, the Windows desktop GPU workers and live public-research connectivity require the user's runtime; no generated media is bundled or claimed by this change.
