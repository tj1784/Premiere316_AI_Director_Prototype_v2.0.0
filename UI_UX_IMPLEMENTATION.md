# Premiere316 V4 application interface implementation

This revision changes the working application, across the film library, Production Bible, screenplay, camera, performance, prompt, asset, generation, review, timeline, and delivery surfaces. No canonical film sources or approval records were replaced by the interface work.

## 4.1 visual composition and media provenance

The film library, Research, screenplay, Character, scene/stage, and asset review workspaces now use bounded cinematic backdrops with their working controls in readable foreground panes. Film home draws from a real linked Prodigal Son frame and the imported picture thumbnail. Stage rails prefer the focused shot or linked scene frame, then show imported asset previews. Asset review places a selected real image behind its thumbnail strip and persistent inspector. The Father character stage defaults to an actual reunion frame; its reference pane retains the imported `PS-CHR-FATHER` asset preview for identity checks. The rejected alternate Father portrait is excluded from the interface and the shipped media.

Source media and new atmosphere have distinct roles. The bundled screenplay, inventory, source package, and research files retain their original records and hashes. Original asset and frame PNG paths identify provenance but are not delivered as Site image files; their optimized WebP previews in `public/pictures/prodigal-son/previews/` are the displayed bytes. The frame manifest maps the ten actual first/last frames to their original paths. The Research landing wallpaper in `public/pictures/prodigal-son/wallpapers/research-galilee.webp` is newly generated environment atmosphere based on the supplied visual board and town reference. It has no principal characters and is not an approved location or character image. Selecting a location displays that location's actual asset preview. New principal imagery must be compared to its imported asset identity and continuity before review; atmosphere never silently becomes an asset iteration or an approval.

The asset library now allows a confirmed removal of an unselected, unreviewed draft image iteration. It records the deletion in the production audit and prevents bundled hydration from silently restoring that removed iteration. It keeps the original media bytes; Undo restores the prior record until another edit. Approved or reviewed images, selected images, images bound to another record, prepared assets, and native receipt-linked media remain protected. The action is not a deletion of the canonical source package or durable generated files.

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
| UX008 Asset library | Search/filter tile cabinet with persistent inspector, all image iterations, comparison, reference repair and approval controls. Confirmed draft iteration removal with audit and Undo protects reviewed and dependent images. Optimized supplied previews display where original PNG bytes are absent. |
| UX009 Scoped prompts | Film, scene, shot and execution views; individual saved shot prompts and compiler controls. |
| UX010 Audio types and audition | Cue editor, voice design, audio import/take review. |
| UX011 Review authority | Separate image, video and audio decision views; underlying approval guards retained. |
| UX012–013 Writing runs and real jobs | Run workspace and jobs/takes workspace remain accessible from the dock. |
| UX014 Timeline and delivery | Clip selection, timeline preview, coverage, finished movie and script package views. |
| UX015 Accessibility/reflow | Desktop bounded panes; controls have labels; short transitions respect reduced motion. Narrow layouts reflow to one column. |

The earlier V4 verification covered `npm run typecheck`, `npm run test:v4` (48 tests), a production Sites build, and a 1363×936 interactive pass through film home, Bible, screenplay, assets, research, performance, camera and audio. The 4.1 media test checks that the bundled picture's thumbnail and every imported asset iteration point to nonempty WebP previews. The imported package's six direct downloads are checked against recorded source SHA-256 digests; archive entries that are not separately served are not presented as direct downloads. Scoped picture and image-deletion tests passed. This is **not** a complete model/runtime UAT: voice bytes, actual generation, audio audition, export, and 200% zoom were not exercised end to end. Source-backed fields that are missing remain explicitly marked missing.
