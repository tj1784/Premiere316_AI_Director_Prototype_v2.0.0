# Production Bible Global Patch

**Patch ID:** `BIBLE-PATCH-GLOBAL-001`  
**Revision:** `1.0`  
**Date:** `2026-09-20`  
**Scope:** All projects, scenes, character preparation, reference retrieval and generation prompts that adopt this production bible.  
**Purpose:** Prevent repeated failures in character preparation, acting, camera coverage, geography, continuity and reference selection.

Apply this as an operational addendum to the production bible. These rules govern future work and requested revisions. They do not order regeneration of completed scenes. Scene-specific shot counts, cast, ages, costumes, music choices and generation modes remain in their project records.

This is a model-ready bible patch and implementation contract. It does not claim that application code, reference bindings or generated performances have already been updated.

## RULE-GPB-001 — Authority and scope

Apply the user's active instructions, current approved screenplay and shot plan, then the revised bible master and compatible specialist manuals. Keep a scoped rule register. Record the effective instruction when sources conflict; never concatenate incompatible instructions into a prompt.

Preserve the requested deliverable, count, regeneration scope and generation settings. Fixes to the bible apply across future work. A correction to one asset affects that asset and its actual dependents; it does not automatically authorize regeneration of an entire sequence.

## RULE-GPB-002 — Everything addressable has an ID

Every production entity, reusable reference, authored direction, versioned state and review record must have a stable, unique ID. Reuse existing IDs and naming conventions. Allocate new IDs through the project's registry; never fabricate existing IDs, renumber records for display order or reuse a deleted ID for another entity.

Use these type keys in the registry. Prefix spelling may follow the existing project convention.

| Type keys | Records covered |
|---|---|
| `PROJECT`, `SCRIPT`, `BIBLE`, `SOURCE`, `RULE`, `PATCH` | Project, authored sources and governing instructions |
| `CHR`, `MEMBER`, `ENSEMBLE`, `CHAR_SHEET`, `CHAR_STATE` | Character identity, individual ensemble members, groups, character sheets and changing states |
| `ASSET`, `ITERATION`, `REFERENCE`, `IMAGE`, `VIDEO`, `AUDIO` | Assets, alternatives, reference bindings and exact media |
| `VOICE`, `VOICE_REF` | Voice identity and selected reference recording |
| `LOC`, `GEO`, `LOOK`, `LIGHT_STATE` | Location, spatial map, photographic treatment and lighting state |
| `COSTUME`, `APPEARANCE`, `PROP`, `PROP_STATE` | Clothing, physical appearance and object continuity |
| `SCENE`, `BEAT`, `SHOT`, `CLIP` | Story and production units, kept distinct |
| `LINE`, `SILENT_BEAT`, `PERFORMANCE`, `CAMERA` | Authorized speech, silent action, acting direction and camera plans |
| `FIRST_FRAME`, `LAST_FRAME`, `CONTINUITY_STATE` | Mode-dependent frame bindings and incoming/outgoing state |
| `SOUND`, `MUSIC`, `EDIT`, `TIMELINE` | Authored sound events, score cues and assembly records |
| `PROMPT`, `WORKFLOW`, `JOB`, `TAKE`, `EXPORT` | Compiled prompts, configurations, generation attempts and outputs |
| `CORRECTION`, `REVIEW`, `APPROVAL`, `REFERENCE_PACKET` | Changes, findings, approval evidence and resolved model inputs |

Other production types use the same ID contract. A field within a record is addressable by its stable field key plus record ID and revision; it does not require a separate top-level entity for every adjective or scalar.

## RULE-GPB-003 — One searchable reference registry

Maintain one authoritative registry per project, with a cross-project index where shared assets exist. Scene and shot indexes are views of this registry, not competing copies of source content.

Every entry includes:

| Field | Requirement |
|---|---|
| `id`, `type`, `project_id` | Stable identity, record type and ownership |
| `name`, `aliases`, `tags` | Human-readable discovery without relying on filenames alone |
| `revision`, `status` | Exact revision and draft, approved, superseded, rejected or unavailable status |
| `canonical_uri`, `locator` | Persistent file/record location and an exact section, page, time range or field where needed |
| `parent_id`, `relations` | Typed links to identity, states, sources, dependencies and outputs |
| `source_refs`, `scope_refs` | Evidence and applicable project, scene, shot, character or beat |
| `selected_iteration_ref`, `approval_ref` | Applicable selection and evidence of approval; null with a reason when not applicable or unresolved |
| `content_hash`, `media_type` | Exact media-byte identity and type, when applicable |
| `supersedes`, `change_reason` | Traceable revisions and corrections |

Store each relationship as an ID plus a pinned revision or immutable version identifier. Preserve existing revision types. A mutable "latest" pointer may support discovery, but generation must resolve it to a specific version first.

Character identity, image iteration, appearance state and selected reference are different records. A cleaner costume reference must not reset a dirty scene state. A new image iteration must not become a new character.

## RULE-GPB-004 — Resolve and inspect references before generation

1. Retrieve the scene/shot reference packet by ID.
2. Resolve its IDs to the exact versions, iterations and persistent locations.
3. Read the character sheets, scene facts, performance and camera records. Open the relevant visual references before every generation; a filename or search snippet is insufficient.
4. Check identity, current appearance, geography, props, framing and mode-specific inputs against the actual selected media.
5. Record the resolved reference IDs and versions in the prompt/job manifest.

An ID is a retrieval key, not a replacement for conditioning media. Attach the required media through the selected engine's supported inputs; compile relevant facts into the prompt. Do not assume a rendering model can dereference project IDs itself.

Treat local scratch paths and previews as caches. Recover missing cache files from canonical references. If recovery fails, name the exact unresolved ID and withhold only the dependent operation. Never substitute another character, asset iteration or voice silently.

## RULE-GPB-005 — Complete character sheets

Before composing a featured character's performance, retrieve and consume the following fields. A portrait collage alone does not satisfy this requirement.

| Stable field keys | Required information |
|---|---|
| `character_id`, `name`, `aliases`, `story_role` | Who this person is; distinguish identity, performer/reference and ensemble membership |
| `age`, `body`, `visual_reference_refs` | Established face, hair, beard, build, proportions, hands and distinguishing features; relevant front, three-quarter, profile and full-body references |
| `voice_identity_ref`, `voice_reference_refs`, `language`, `accent` | Established voice, usable reference binding, register, grain, habitual rhythm and pronunciation where authored |
| `baseline_mobility`, `movement_habits` | Sourced posture, gait, gesture habits, handedness if established and physical limitations |
| `wardrobe_refs`, `appearance_state_refs`, `prop_refs` | Baseline costume and the distinct states and objects used by the story |
| `authored_history`, `wound`, `lie_or_belief` | Relevant events and defensive beliefs supported by the authored material |
| `super_objective`, `want`, `need` | Film objective, conscious external goal and the inner change the story tests |
| `mask`, `tells` | Public behavior and specific changes in face, attention, breath, voice, hands, posture or pace under pressure |
| `relationship_refs`, `foils` | Bonds, status, trust, conflict and the particular pressure each relevant partner creates |
| `knowledge_boundaries` | What the character can know, suspect or misunderstand; what must not be anticipated |
| `regulation`, `release_conditions`, `recovery` | Containment, permitted expression, triggers for release and what remains afterward |
| `authorized_line_refs`, `sound_permissions` | Allowed dialogue and separately authored vocal events |
| `performance_reference_refs`, `prohibited_inventions` | Approved acting benchmarks, the qualities to follow, and limits on invented history, words, behavior or identity |

Each field carries a value or an explicit missing/not-applicable disposition, source reference and status. Mark performance interpretation as direction rather than biographical fact. A witness or extra may have no relevant wound or inner transformation; give a role reason instead of inventing one.

Missing nonessential biography does not block useful preparation. Missing essential visual or voice conditioning prevents only the generation that depends on it. Do not label a draft reference approved because it has been used previously.

## RULE-GPB-006 — Character state for each scene and beat

Link every featured participant to a `CHAR_STATE` and `PERFORMANCE` record. Record the incoming situation, current knowledge, immediate objective, partner, obstacle, concealed feeling, displayed behavior, attention target and permitted physical action.

Keep identity separate from temporary exhaustion, injury, tears, dirt, strength, costume and emotional state. A feeling can change without physical recovery. Record a release or recovery only when the story earns it.

Every narratively relevant silent participant receives an individual task and location. Background people do not freeze while the lead acts, and they do not all mirror the lead's expression. Incidental crowds may use an ensemble record; recurring or individually featured members receive their own IDs.

## RULE-GPB-007 — Detailed acting during speech and silence

Write the beat from the character's objective and current knowledge. Specify the trigger, attempted control, observable response, effect on the partner and outgoing residue where relevant. An intention may change, resist change or deliberately persist.

Use playable actions directed toward a person or task. Describe the timing and relationship among gaze, mouth, jaw, breath, voice, touch, posture and effort. Select compatible cues; do not activate every facial region at once or repeat the same swallow, blink and tremor in every shot.

Silent performance still contains thought: watching for an answer, concealing recognition, resisting comfort, deciding whether to approach, finishing a task despite distress or withholding a reply. Purposeful stillness must retain its subject and intention.

The Daniel Day-Lewis acting example establishes the required precision of cause, timing, physical effort, vocal texture and aftermath. It does not prescribe his likeness, voice, dialogue or maximum display. Felt intensity, displayed affect, expression allowance and vocal loudness remain independent.

**Acceptance test:** If the character sheet and scene facts could be removed without changing the acting paragraph, the paragraph is too generic. Rewrite it before generation.

## RULE-GPB-008 — Camera coverage must expose the acting

Every `CAMERA` record specifies starting composition, subject, camera position and height, axis, path, timing, focus behavior, landing composition and dramatic purpose. Execute the requested camera dynamics. Do not default an entire sequence to static shots.

Match the visible evidence to the shot: facial detail requires readable facial scale; balance and gait require the relevant body coverage; contact requires visible support and hand placement; an aerial view communicates route, distance and collective movement.

A motivated hold may let a thought finish. Camera movement must reveal or accompany the authored event, rather than decorate it with unrelated maneuvers. Preserve the approved coverage while allowing its explicitly authored changes in angle and framing.

Use precise terms: dolly translates toward/away; truck travels laterally; pedestal raises/lowers; pan and tilt rotate; rack focus changes the focus plane; zoom changes focal length. Do not use focus or zoom wording as a substitute for requested travel.

Do not direct invisible body cues or change framing merely to accommodate an unnecessary gesture. Revise the cue or the camera plan consistently with the user's instructions.

## RULE-GPB-009 — Geography and ensemble contact

Every scene binds a `GEO` record identifying landmarks, routes, distances, elevations, entrances, exits, actor positions and camera axis. Derive screen-left/right from the actual camera view; a reverse angle does not mirror the world.

Movement consumes distance and time. Characters enter, approach and leave along plausible routes. Keep required participants visible when specified, and track their offscreen positions when they are outside the frame.

For contact, name the initiator, relevant hand or limb, destination, remaining support, recipient response, weight transfer and settled endpoint. Reconcile these against the starting image. Do not instruct a hand to perform two incompatible jobs or release weight support for an expressive gesture.

## RULE-GPB-010 — Continuity is explicit state inheritance

Each shot or continuation links incoming and outgoing `CONTINUITY_STATE` records and the appropriate predecessor. Track identity, knowledge, attention, emotion, breath, body position, strength, contact, wardrobe, dirt, tears, injuries, prop ownership/location and lighting.

Completed actions stay completed. A cut does not replay an arrival, collapse, embrace, prop pickup, spoken line or emotional onset. Distinguish ongoing action from a genuine new event.

Inspect the starting image for contradictions. If its geography, identity, costume or prop state is wrong, correct the failing source within the authorized scope before dependent generation. Prompt prose cannot establish that wrong starting pixels have already been repaired.

## RULE-GPB-011 — Exact speech and executable timing

Every spoken event links an authorized `LINE` record with speaker, listener and protected text. Serialize the assigned words once. Keep acting directions and inner thoughts out of spoken text. Silent beats keep spoken text empty while retaining separately authorized breath, crying or other sound events.

Bind the established voice identity and exact reference version for supported native audiovisual dialogue. Emotional delivery changes the performance, not the person. Preserve the revised bible's voice policy; do not invent capabilities or silently switch to separate TTS/audio-to-video fallback.

Budget dialogue, pauses, reactions, physical effort and travel against actual supported duration. Resolve an infeasible shot through the project's duration/continuation policy. Do not solve it by teleporting, speeding away weakness, dropping words or silently multiplying editorial shots.

## RULE-GPB-012 — Compile complete prompts from resolved packets

Use the selected engine/mode serializer and actual workflow capabilities. Generate a complete, chronological prompt integrating performance, partner responses, camera and authorized audio. Keep audit metadata outside engine prose unless the adapter uses it.

Do not make the user assemble detached acting, camera and continuity patches. A revision returns the complete replacement prompt for the affected unit. Retain meaningful detail; remove contradictions and repetition rather than stripping away performance.

Preserve requested first-frame, last-frame, reference-only or continuation modes. Require only the inputs the selected workflow uses. Shot count, aspect ratio, full-body coverage, score policy and display allowance are scoped creative choices, not universal restrictions.

## RULE-GPB-013 — Corrections and verification

Give each correction an ID, source, effective scope, affected IDs, superseded rule/value and reason. Traverse dependencies to identify which future packets need recompilation. Do not regenerate completed media without authorization.

Before generation, verify resolved references, character completeness, active silent acting, readable coverage, geography, contact, inherited state, exact speech and timing. Missing critical information must name the affected ID and operation.

After generation, inspect the actual output for identity, performance, motion, participants, geography, dialogue and sound. A compliant prompt is not proof of a compliant take. Store each finding under a `REVIEW` ID linked to the exact `TAKE` and reference versions.

Repair the earliest failing dependency and the affected transitions. Distinguish source review, prompt validation, image review, video review and file/package integrity in completion reports.

## CONTRACT-GPB-001 — Shot reference packet

The following is a template, not a populated project record. Placeholder strings and empty required bindings must fail execution validation. Optional bindings depend on the selected mode and authored scope.

```json
{
  "id": "<existing-or-new-reference-packet-id>",
  "revision": "<packet-revision>",
  "project_ref": {"id": "<project-id>", "revision": "<revision>"},
  "scene_ref": {"id": "<scene-id>", "revision": "<revision>"},
  "shot_ref": {"id": "<shot-id>", "revision": "<revision>"},
  "rule_refs": [],
  "source_refs": [],
  "participants": [
    {
      "character_ref": {"id": "<character-id>", "revision": "<revision>"},
      "sheet_ref": {"id": "<character-sheet-id>", "revision": "<revision>"},
      "state_ref": {"id": "<character-state-id>", "revision": "<revision>"},
      "performance_ref": {"id": "<performance-id>", "revision": "<revision>"},
      "visual_reference_refs": [],
      "appearance_refs": [],
      "voice_reference_refs": [],
      "line_refs": [],
      "silent_beat_refs": []
    }
  ],
  "location_refs": [],
  "geography_refs": [],
  "look_refs": [],
  "lighting_state_refs": [],
  "prop_state_refs": [],
  "camera_ref": {"id": "<camera-id>", "revision": "<revision>"},
  "incoming_state_ref": {"id": "<incoming-state-id>", "revision": "<revision>"},
  "outgoing_state_ref": {"id": "<outgoing-state-id>", "revision": "<revision>"},
  "predecessor_refs": [],
  "mode_reference_bindings": [],
  "sound_refs": [],
  "music_refs": [],
  "workflow_ref": {"id": "<workflow-id>", "revision": "<revision>"},
  "correction_refs": [],
  "review_refs": []
}
```

Each resolved media reference supplies its immutable iteration/version, canonical location, relevant locator, content hash where applicable and selection/approval evidence. Store the resolved packet alongside the prompt/job manifest so a reviewer or subsequent model can retrieve exactly what the generator used.

## CONTRACT-GPB-002 — Adoption and migration

1. Add this patch to the bible's rule register under `BIBLE-PATCH-GLOBAL-001` and retain the rule IDs above.
2. Inventory existing project IDs and resolve duplicates or aliases without breaking references. Preserve existing approved source content and settings.
3. Register previously unaddressable records and versions. Backfill canonical locations, typed relationships and provenance from actual evidence.
4. Add missing character-sheet and state fields using authored sources. Preserve explicit unknown and not-applicable values.
5. Build scene/shot reference packets and dependency links from existing records; do not duplicate canonical content into competing registries.
6. Apply these checks to new work and requested revisions. Implement application validation separately where required; never report documentation changes as deployed enforcement.

## SOURCE-GPB-001 — Governing source

`Cueboard_Production_Bible_R4.html` — persistent source identifier `libfile_1b37e542e0108191a14729ab3878dd10`.

Relevant master sections: Authority and precedence; Movie process; Character sheet; Silent performance; Ensemble action; Beats and inheritance; Camera and material world; Voice, sound and score.

Compatible archived specialist sections: Character Development pages 28–31; Character Sheet pages 32–33; Acting Direction pages 42–44; Acting Prompt pages 45–47; Camera Motion pages 48–55. The revised master and active project instructions resolve conflicts with historical examples.

The patch, rule, contract and source identifiers in this document identify this addendum's records. They do not claim that a project's master registry or application has already imported them.
