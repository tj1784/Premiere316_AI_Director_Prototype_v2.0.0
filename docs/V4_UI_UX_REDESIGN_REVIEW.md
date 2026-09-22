# V4 desktop UI/UX implementation review

This change preserves Home's existing movie-script library and creation flow. It updates the working application on `premiere316_V4`; it does not replace the separate wireframe-review website or build a Windows executable.

## Capability-to-screen map

| Reference | Reachable workspace | Change / retained operation |
| --- | --- | --- |
| WF-01 | Home | Real project covers, search, My scripts / samples filters, recent-script resume, existing new-script action. |
| WF-02 | Overview & Sources | Existing setup and profile handlers retained; explicit Step-by-step review / Autonomous — Complete Movie Script labels; profile shortcut in the global header. |
| WF-03 | Story & chronology | Existing research, source ledger, source editing and approval retained; shared controls and focus styling updated. |
| WF-04 | Characters & world → Characters / Scene states | Category navigation; identity, motivation/relationships, performance/voice groups; linked image and voice preview; separate canonical record and participant state. |
| WF-05 | Characters & world → Locations / Props / Wardrobe | Geography and atmosphere groups; linked scenes and asset iteration navigation. Existing canonical IDs and field-edit handlers retained. |
| WF-06 | Screenplay | Navigator opens the actual selected scene; full-script view remains available; scene beats and speaking-character context; writing/settings and revision panels separated. Manual edits retain unchanged source text and line endings. |
| WF-07 | Scenes & performance | Existing full Cueboard and performance workspace retained, including proposal comparison, review and apply controls. |
| WF-08 | Camera & continuity; Shots & coverage | Existing camera/continuity and coverage controls retained; workspace tab choice persists. |
| WF-09 | Assets & iterations → Library | Preview tiles and resizable docked inspector; all image iterations, selection, side-by-side comparison, enlargement, prompts, import/reference controls, reference search, generation and authoritative review. Preparation/specification remains a separate visible tab. |
| WF-10 | Prompts | Separate global/inherited look, scene, local-shot and execution views. Selected-shot payload preview calls the existing engine compiler; complete prompt copy/export and full payload evidence remain available. |
| WF-11 | Sound & music | Separate cue editor, character voices and audio-take/import views. Existing audio bytes use native audio controls. Specialist execution, imports and review handlers remain explicit. |
| WF-12 | Script runs & checkpoints | Both candidate revisions use the same readable renderer; structured field differences; exact successor label; acceptance and acceptance-plus-execution remain separate actions. Pending edits persist by run and unit. |
| WF-13 | Script runs & checkpoints | Durable coverage ledger, real progress count and retained pause/cancel/resume/package controls. Machine checkpoints keep their existing non-human-approval status. |
| WF-14 | Jobs & takes; Reviews | Existing generation jobs, playable media and review handlers retained. Image review is shared with the asset inspector without removing authority, prepared-root, receipt or continuity checks. |
| WF-15 | Timeline & soundtrack | Existing player/timeline preserved; editorial clip selection and sequence review are also accessible from the timeline. |
| WF-16 | Delivery | Script/production package, finished movie, and readiness/other exports are separate views. Existing actual save/render/approval handlers retained; exported-file count comes from the package. |

Shared changes include readable controls, visible scrollbars, keyboard focus, warm charcoal/ivory/gold tokens, human-readable breadcrumbs, persistent selections and workspace expansion. Scene → asset → character sheet links use existing record identities; a non-unique scene match is reported instead of guessed.

## Persistence and authority

- Layout preferences, selected records and pending review edits use the existing project `editorDrafts` store. They do not become new canonical source records or provider settings.
- Manual scene editing is bounded by the parsed source span. Textarea CRLF normalization is mapped back to source offsets, and unchanged text is retained exactly.
- The extracted image-review component retains backend authority and prepared-root verification, generation receipt requirements, continuity confirmations, reviewer reason, and explicit approval/rejection calls.
- Displaying or comparing an image does not approve it. Navigation does not start a production job.
- Existing destructive/recovery operations remain in their canonical workspaces. Image review is append-only; this UI change does **not** introduce physical image-file deletion or a new deletion authority.

## Verification evidence

Automated checks run for this implementation:

- TypeScript typecheck.
- Production build.
- V4 regression suite, including new tests for exact scene editing, CRLF selection mapping, unchanged dialogue/source preservation and structured revision differences.
- Focused existing asset-generation, screenplay hierarchy, canonical image review, backend status and responsive/stage-layout tests.
- ESLint on newly introduced components and helpers; whitespace/diff validation.

These checks verify compilation and the exercised logic. They do not establish visual acceptance, keyboard walkthroughs, playback of user-local files, or a live inference result.

### Outstanding visual acceptance

The available browser rejected the local app URL with `net::ERR_BLOCKED_BY_CLIENT`. Its accessible review website is the static wireframe gallery, not this application build. Therefore no desktop/narrow screenshots, full keyboard walkthrough, or dev-versus-production renderer pass is claimed for this change. The default dev startup also encountered a host network-interface discovery error; an explicit loopback dev invocation started, but it did not make the app reachable by that browser.

Windows/Electron rendering, real Astra/specialist inference and the user's local media playback were not verified. Existing application surfaces retained above are not certified as satisfying every broader Bible acceptance requirement merely because their controls remain reachable. Whole-application visual acceptance is still pending.
