# Premiere316 V3 — Stage Layout Matrix

This file is the canonical UI-shell visibility policy.

| Stage | Left area | Center | Right area | Bottom | Primary header actions | Must not appear |
|---|---|---|---|---|---|---|
| Pictures | Picture filters/search when needed | Project cards and + New Picture | None or selected project summary | None | New Picture, Open | Shot Inspector, FLUX, Timeline |
| Intake | None | Intake form | None | None | Save, Continue | Bin, Engines, Models, Shot Inspector, Generate, Timeline, Rewrite |
| Research | Research Bible sections | Research evidence/analysis | Sources, confidence, disputes | None | Research, Delta Research, Approve | Generate rails, Shot Inspector, Timeline |
| Screenplay | Acts/Sequences/Scenes | Fountain/editor | Local Writer, Versions, QA | None | Rewrite Scope, Review, Approve | FLUX, media Bin, Timeline |
| Inventory | Asset categories | Asset grid/workspace | Asset Inspector | None | Breakdown, Prepare Assets | Shot Inspector, Animate, Timeline |
| Visual Development | Boards/categories | Character/location/wardrobe/prop bibles | Selected concept/reference | None | Develop, Compare, Approve | Video controls, Timeline |
| Cinematography | Sequences/scenes | Manifesto and visual plans | Cinematography Inspector/QA | None | Develop, Review, Approve | Generate Still unless explicitly launching an asset drawer |
| Performance | Scene→Beat | Performance direction | IN/OUT continuity and locks | None | Approve, Prepare Shots | Global Bin/Engines/Models, FLUX, Timeline |
| Shots | Scene→Beat→Shot | Canonical ShotSpec editing | Continuity warnings and prepared queue | None | Add, Split/Merge, Prompt Lab | Duplicate global Inspector, FLUX rail, Timeline |
| Prompt Lab | Shot/prompt entries | Canonical spec + compiled prompts | Compiler/model/status | None | Compile, Compare, Approve | Timeline, unrelated generation inspector |
| Generate | Bin/Engines/Models | Media grid, versions, selected generation | Generation Inspector, controls, residency, telemetry | None | Generate Selected, Queue | Timeline |
| Review | Takes/filters | Comparison and playback | QC/continuity findings | None | Approve, Reject, Retake | Editing timeline unless explicitly opened |
| Stitch/Edit | Media Bin | Preview/edit workspace | Clip Inspector | Timeline | Save Edit, Preview Render | Unrelated screenplay/asset controls |
| Voice | Characters/lines | Voice profiles and takes | Delivery/consent/telemetry | Optional audio strip later | Prepare, Generate, Approve | FLUX/video controls |
| Sound | Cue list | Foley/SFX/ambience | Cue Inspector | Optional audio strip later | Prepare, Import/Generate, Approve | Image/video controls |
| Score | Cue list/themes | Score cues and versions | Cue/Music3 Inspector | Optional score strip later | Prepare, Generate, Approve | Shot Inspector, FLUX, Timeline by default |
| Master | Blocker categories | Readiness/preflight/render | Export profile/provenance/license | None | Preflight, Render Master | Creative generation controls |
| Export | None or export history | Delivery formats and archive | Selected export details | None | Export | Bin, Engines, Models, Shot Inspector, FLUX, Timeline, Rewrite |

Rules:

1. The shell must not reserve empty panel columns.
2. Stage-owned panels replace global production panels.
3. Timeline is visible only on Stitch/Edit unless a later stage deliberately implements its own distinct audio/cue timeline.
4. Header actions are contextual.
5. Generate is the only current stage that owns the global Bin/Engines/Models + generation inspector composition.
6. Test inside packaged Premiere316.exe at 100% and 150%.
