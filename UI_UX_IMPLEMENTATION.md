# Premiere316 V4 application interface implementation

This revision changes the working application, across the film library, Production Bible, screenplay, camera, performance, prompt, asset, generation, review, timeline, and delivery surfaces. No canonical film sources or approval records were replaced by the interface work.

## Navigation and composition

The project header carries an icon-only transparent dock. All workspaces are available in its searchable cabinet. Camera separates physical continuity, cinematography and source geography. Performance separates beat direction from emotion and voice; the full Cueboard remains linked. Prompts keep film, scene and local shot scope distinct, with a separate saved-prompt selector. Reviews separate image, video and audio decisions. Assembly separates preview, clip order and coverage. The asset library keeps its searchable gallery and image iteration inspector visible together. Research uses visible section tabs, a full-width source editor and a contextual status/version inspector. Its availability display now respects the Astra profile instead of incorrectly demanding a local LM Studio server. Audio direction has a cue list and focused editor, with specialist execution separate. The screenplay keeps the complete script and a bounded, persistent scene/source/writing/version inspector alongside it. Local panels scroll independently; the main viewport stays bounded.

Missing Bible fields appear in the film record board without inventing values. Film home keeps source import and creation as direct actions and no longer reserves a blank cover area when no cover exists. Generation settings and imported package details live in cabinets. Selected and approved image iterations remain separate.

## Requirements coverage and verification scope

| Bible requirement | Interface location and evidence |
| --- | --- |
| UX001–002 Visual system and contextual navigation | Shared workbench tokens and bounded stages in `src/styles.css`, icon dock / anchored searchable panel in `workspace-navigation.tsx`. |
| UX003 Setup, profile, execution mode | Film intake and profile controls remain in the brief, research and screenplay workspaces and settings. |
| UX004 Source authority and story | Film Bible source passages, corrections, record picker; research source workspace. |
| UX005 Characters, world, state | Character sheet and linked scene state; Bible record board and source geography. |
| UX006 Screenplay | Full Fountain script plus selected scene, source, writing and revisions side inspector. |
| UX007 Performance, camera, continuity | Beat/performer direction with source and carry state; full emotion controls; separate physical and cinematic views. |
| UX008 Asset library | Search/filter/paged tile cabinet with persistent inspector, all image iterations, comparison, reference repair and approval controls. Missing media is identified as unavailable. |
| UX009 Scoped prompts | Film, scene, shot and execution views; individual saved shot prompts and compiler controls. |
| UX010 Audio types and audition | Cue editor, voice design, audio import/take review. |
| UX011 Review authority | Separate image, video and audio decision views; underlying approval guards retained. |
| UX012–013 Writing runs and real jobs | Run workspace and jobs/takes workspace remain accessible from the dock. |
| UX014 Timeline and delivery | Clip selection, timeline preview, coverage, finished movie and script package views. |
| UX015 Accessibility/reflow | Desktop bounded panes; controls have labels; short transitions respect reduced motion. Narrow layouts reflow to one column. |

Validation: `npm run typecheck` and `npm run test:v4` (48 tests) passed. Production Sites build succeeded. Interactive preview verified film home, Bible, screenplay, assets, research, performance, camera and audio at 1363×936, with no body overflow. Dock search and inline Research profile were exercised separately. This is **not** a complete model/runtime UAT: actual media references shipped without their image or voice bytes and appear unavailable; generation, audio audition, export, mobile and 200% zoom were not exercised end to end. Image iteration deletion is not implemented by this interface revision; do not claim UX008 deletion acceptance. Source-backed fields that are missing are explicitly shown as missing.
