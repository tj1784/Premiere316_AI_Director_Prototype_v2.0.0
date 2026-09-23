# Premiere316 V4.1 cinematic workspace implementation

## Visual system

The supplied four-screen reference is the visual anchor for the working application. The film or selected real asset fills the canvas. An icon dock sits at the top; the selected image rail sits at the bottom. Editorial titles occupy the open side of the image. A single translucent inspector holds current controls and source information. Long records open within that inspector or a dedicated full reading view; they do not become additional floating cards.

The application uses actual imported Prodigal Son frames, character reference sheets and location previews. On Asset Library and image Review, the selected asset itself drives the background and bottom carousel. Pages without an image use a truthful text or empty state. User generated media remains a draft until the existing approval flow verifies and accepts it. Navigation, previewing and comparing do not approve media.

The shared desktop shell is in `src/components/studio/shell.tsx` and `cinematic-shell.css`. Home is in `pictures-library.tsx` and `ps5-canvas.css`. The generic production canvas and rail are in `stage-views.tsx` and `stage-visual-surfaces.css`. Individual inspectors remain in their corresponding workspaces, so each still uses its original state and action handlers.

## Workspace and content map

| Workspace | Source-backed content and principal interaction |
| --- | --- |
| Home | Saved films, Resume, New film, source import and film selection; real cover where present. |
| Brief & sources | Intake brief, film contract, story settings, source reference images and script run entry. |
| Story & chronology | Research Bible, citation classes, source authority, conflicts, notes and approval. |
| Production Bible | Film direction, complete field reading/editing, original source manifest, source hashes, history, and linked records. |
| Screenplay | Imported Fountain, bounded scene editing, full script, source and continuity context, revisions and scene image rail. |
| Characters & world | Canonical character/location/prop/wardrobe data, all 17 character fields, scene state, voice/references and existing portraits; Visual development has its own view. |
| Scenes, Camera, Shots, Prompts | Performance, geography, shot coverage and scoped render direction retain their real editors with a selected frame and focused working surface. |
| Assets | Canonical specifications, draft image iterations, prompt and reference review, generation controls and existing approval decisions. The selected actual image is the backdrop. |
| Jobs & takes | Real asset/frame/video queues, availability and import controls. Optional model setup is subordinate to the selected production task. |
| Sound & music | Authored cues, character voices, imported takes, playback and specialist availability. |
| Reviews | One selected image/video/audio review at a time, exact file/provenance, continuity checklist, reason and existing approval gates. |
| Movie timeline | Selected shot still, shot order, picture and audio lanes, coverage and real assembled movie playback when available. |
| Script runs | Bounded guided/complete script work, checkpoints and source text package. |
| Delivery | Complete writing and production handoff, individual exports, finished movie and readiness. |

## Bible source and authority

`movie-bible.ts`, `imported-source-records.ts`, and the Bible editor index the imported package manifest, intake, research, screenplay and linked production records. Twelve manifest entries retain their stable identifiers and SHA-256 digests. A download link appears only for a source file actually supplied as a direct resource; the full retained research notes are searchable. The source tab distinguishes exact source text from a related intake note. An empty explicit Bible field stays open rather than being silently filled by a merely related premise, story note or dialogue style.

One manifest entry, `inventory_summary.json`, has a recorded digest but no available bytes in the supplied files or the package archive. It appears as a manifest-only entry with no download link. This does not prevent reading the rest of the imported Bible or the available original files.

Approvals still require their existing gates. A selected draft, uploaded image, rendered thumbnail or displayed screenplay is not marked canonical merely by appearing in the interface. Local provider availability and execution provenance are reported from real state.

## Verification and limits

The managed local preview was checked at a 1366 × 936 desktop viewport across Home, Brief, Research, Bible, Screenplay, Character, Asset Library, Visual development, Camera, Prompt, Sound, Review, Timeline, Script runs and Delivery. Real image loading was checked after hydration, and selection of a different Timeline shot and Asset Library character updated the active content. TypeScript and production build are release gates; the focused Bible manifest tests verify source records and digest linkage.

This preview does not establish Windows/Electron renderer parity, local specialist inference, playback of unavailable media, or approval of visual direction by the user. An assembled movie is unavailable until its actual clips are rendered and bound. The source manifest limitation above is preserved rather than reconstructed.
