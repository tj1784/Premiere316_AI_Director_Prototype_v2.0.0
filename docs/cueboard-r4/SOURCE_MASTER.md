# Cueboard · The Production Bible

Revision **2026-09-19-R4** · Implementation edition for the existing **Premiere316 Electron application**.

This is the redesigned and reconciled production document. It does not redesign, replace, or replatform the application. The implementation baseline is `90c6732ba210332984a6e6aff13b9ac718419e76` on `codex/voice-reference-emotion`, which was also the branch head when inspected.

<!-- chapter: authority | Read this first | 01 / THE REVISED MASTER -->
## One production language. Clear authority.

Cueboard translates story intention into a playable performance: what a character wants, what the moment means, what can be seen and heard, and how that state continues into the next beat. It is a performance compiler inside the existing film workflow.

The HTML edition combines a readable master, the **complete supplied catalog**, and an indexed source archive. It distinguishes the system that exists from the refinements still to implement.

| Label | Meaning |
|---|---|
| Existing implementation | Observed in repository source at commit `90c6732`; real inference is not thereby verified. |
| Revised specification | R4 decisions in this master; implementation must be checked and completed explicitly. |
| Project preset | A creative choice for a particular film, scene, character or engine profile. |
| Historical source | Preserved text from the original binder; conflicting rules do not override this master. |

### Authority and precedence

Apply the user's active instructions and the project's approved screenplay and shot plan. For implementation policy, use the scoped R4 decisions here; consult the source manuals for compatible detail. Historical examples, house styles and unsupported model explanations are not universal validators.

Retain a rule register with `rule_id`, `revision`, `scope`, `status`, `supersedes`, and a short rationale. Never resolve a conflict merely by concatenating both instructions into the model prompt. Record the effective rule and explain withheld controls.

### Adopted global production patch

[BIBLE-PATCH-GLOBAL-001, revision 1.0](Production_Bible_Global_Patch.md) is the operational addendum for future work and requested revisions across projects adopting this bible. The [addendum rule register](RULE_REGISTER.md) retains all 13 rule IDs, both contracts, source provenance and adoption status. It governs reference retrieval, character preparation, acting, camera coverage, geography, continuity, exact speech and review.

The user's first-frame-only scene-generation instruction remains effective; the addendum's mode-dependent LAST_FRAME type does not require a last frame. This adoption does not regenerate completed scenes, migrate project records, or claim deployed application validation. Resolve project registry backfills and reference packets from actual evidence when implementing the contracts.

### Global render descriptions

[Global Prompt Patch revision 1.0](Production_Bible_Global_Prompt_Patch.md) extends the adopted global production patch. Deliver a separately identified global render description, local prompts and execution/reference notes. Shared text contains only applicable audiovisual qualities; timeline settings, changing cast/state, plot, scoped score and authoring instructions remain in their own records. Inspect actual backend global-field behavior and review every affected combined prompt. Preserve local acting depth and camera dynamics. See the [rule register](RULE_REGISTER.md).

### What changes in R4

| Rule ID | Revised decision | Conflict resolved |
|---|---|---|
| CB-R4-01 | Keep felt intensity, displayed emotion, display allowance, arousal, regulation and vocal loudness independent. | A breakdown example cannot turn every level seven into shouting or violence. |
| CB-R4-02 | Inherit framing from the selected approved coverage plan. | A global close-up default cannot overwrite varied angles. |
| CB-R4-03 | Keep exact dialogue in a protected field; serialize it once. | Acting directions and alternate wording must not become new speech. |
| CB-R4-04 | Use a versioned serializer for the selected engine and actual mode. | Older header-heavy LTX examples and newer flowing prose are not simultaneous instructions. |
| CB-R4-05 | Generate film dialogue natively with approved voice identity references. | Remove automatic separate-TTS or audio-to-video fallback from this pathway. |
| CB-R4-06 | Keep character identity plates distinct from scene composition frames. | A single-subject plate rule must not forbid crowds or two-shots. |
| CB-R4-07 | Require only assets and prompts needed by the chosen workflow. | H3-only work does not need a mandatory LTX prompt; predecessor output is a dependency. |
| CB-R4-08 | Carry forward authored physical and performance state. | A new scene or clip does not clean costumes or restart an emotional onset. |
| CB-R4-09 | Use one documented camera-axis convention. | Positive dolly-toward cannot also mean pull-back. |
| CB-R4-10 | Scope Scene 18 laws, tool vendors, score choices and aspect ratios as presets. | Film-specific rules must not govern every movie. |
| CB-R4-11 | Permit role-appropriate character fields to be explicitly not applicable. | A witness or extra does not need an invented wound or trauma. |
| CB-R4-12 | Distinguish no music, native score direction and a continuous post-production score. | A repeated music description cannot guarantee the same composition across clips. |

### What is preserved

The original 111-page PDF contains **65 unique extracted pages** and **46 exact repeats**. All 65 unique pages remain available in the source archive, with original page numbers and a duplicate map. Text visibly clipped in the source at pages 3, 10 and 17 cannot be recovered by reformatting; this edition does not invent its missing endings. The revised tables use the inspected code contract and the review decisions instead.

The emotion catalog is an editorial library of performance choices, not a diagnostic instrument or an exhaustive taxonomy of every possible human feeling. Its full supplied contents are included without claiming scientific intensity thresholds.

<!-- chapter: process | Movie process | 02 / FROM STORY TO SCREEN -->
## Finish the intention before the queue.

Develop one cohesive movie. A scene, line, shot and generated clip are related production units, but their IDs and responsibilities must remain distinct. A single editorial shot may need multiple engine clips.

| Phase | Develop and review | Exit condition |
|---|---|---|
| A · Movie Script | Premise, moral question, character roles, causal scenes, exact dialogue, silent beats, camera plan, clip table, performance, image requirements, sound and score plan, engine prompt drafts. | The approved story and selected shot/clip plan contain the information needed for the chosen generation path. |
| B · Assets | Character and location identity, one approved first frame for scene generation, props, wardrobe states, approved voice identity references. | Required references resolve to the correct identities and revisions; review is recorded. |
| C · Movie | Validate, compile, generate, review takes, continue dependent clips, assemble, score and export. | Outputs pass the applicable speech, picture, continuity, performance and technical review. |

A generation failure can return work to an earlier phase. It must not silently rewrite an approved story or substitute an actor, voice or image. Required gates remain scoped to the actual workflow and existing approval policy.

### The picture contract

Record a stable picture ID, title, premise, audience/treatment, moral question, target runtime, language, picture format, frame rate, delivery format, continuity policy, selected engines/modes, voice policy and score strategy. Preserve intentional choices already in the project. A runtime tolerance, 21:9 or 2.4:1 frame, 24 fps, vendor preference or default model belongs to the project profile.

### Required indexes

Maintain stable references among scene, character, location, costume state, prop, dialogue line, silent beat, voice reference, image iteration, shot, generated clip and music cue. An index is a map to actual records; it must not be a second conflicting source of content.

| Clip-plan field | Meaning |
|---|---|
| Identity | Picture, scene, shot, clip and source-version IDs. |
| Story purpose | Observable action, value change, relationship move and what the audience learns. |
| Dialogue | Authorized speaker and exact line IDs, or an explicit silent beat. |
| Time | Editorial duration plus actual engine-valid duration, frame count and continuation policy. |
| Composition | Approved shot size, camera direction, lens/focus intent and subject positions. |
| Performance | Applied Cueboard version and continuity link. |
| References | Required identity assets, approved iterations and the approved scene first-frame binding. No last-frame binding is required. |
| Audio | Native dialogue, allowed authored sounds, ambience and score choice. |
| Engine | Selected adapter/mode, workflow revision and preserved generation settings. |
| Review | Current readiness, unresolved warnings, take status and the next required decision. |

Scene generation requires one approved first frame only. Do not require a last-frame image, last-frame prompt, first/last-frame pair, or last-frame approval. Missing last frames must not block scene generation. Preserve authored continuity in the scene prompt; a reusable character plate is not automatically a scene first frame.

<!-- chapter: story | Story & character | 03 / THE HUMAN CAUSE -->
## Every visible choice begins somewhere.

Build the story through premise, causal outline, scene purpose, character opposition, exact dialogue, silent action and a final continuity pass. Each scene changes a value, relationship, decision or understanding. Atmosphere supports that change; it does not replace it.

### Scene card

Record where and when the scene occurs, the incoming condition, each participant's immediate objective, obstacle, knowledge, turning point, outgoing state, authorized speech, silence and physical action. A scene can contain multiple emotions and different objectives for different people.

### Character sheet

| Field | Production use |
|---|---|
| Stable identity and story role | Distinguish character, ensemble member, actor/reference and appearance state. |
| Baseline | Age band, established face/body, language, accent, habitual voice, mobility and default wardrobe. |
| Want | The conscious external result the character tries to obtain. Phrase it as an action. |
| Need | The inner shift the story tests, when applicable to the character's role. |
| Wound and lie | Specific authored history and belief, if relevant; never invent them to fill a form. |
| Mask | The public behavior used to manage what other people see. |
| Leaks and tells | Character-specific changes in attention, face, breath, hands, posture, pace or distance. |
| Knowledge boundary | What is known now, what remains concealed and what cannot be anticipated. |
| Regulation | Usual containment, displayed affect and the conditions that change them. |
| Relationships | Who is addressed, protected, opposed, avoided or trusted in this beat. |
| Prohibited inventions | Unapproved dialogue, new backstory, relationships, gestures or changes of identity. |
| Release and carryover | The event that permits a change and what survives into the next beat. |

A lead, foil, witness and background extra need different depths of preparation. Mark irrelevant wound/lie/need fields as **not applicable with a role reason**. Keep everyone physically and socially specific without manufacturing a private tragedy.

### Silent performance

For a silent beat, keep `spoken_text` empty. Derive playable behavior from the approved scene fact, objective and character baseline. Listening, refusal, waiting, receiving a touch, choosing distance and continuing a task can carry the story. A sound permission alone does not authorize an improvised gasp, laugh or sob.

### Ensemble action

Describe each participant separately: who initiates, where the hands go, what supports the weight, who yields, how the second person receives the contact, and the settled endpoint. Preserve character/member IDs and reference bindings. An instruction such as “they embrace” is insufficient when contact mechanics and continuity matter.

<!-- chapter: emotion | Emotion architecture | 04 / INNER STATE & OUTWARD FORM -->
## The depth of a feeling is not its volume.

Use the existing catalog hierarchy: **major family → subfamily → state → variant**, then choose **intensity 1–7**. Family and subfamily are navigation groups. The playable selection stores `emotion_id`, `variant_id` and `intensity`; it does not ask the actor to perform every child state.

The supplied catalog contains **10 families, 57 subfamilies, 81 states and 162 variants**. Each state has seven authored levels and each variant has seven level modifiers: **1,134 state/variant/intensity combinations**. These are resolved combinations, not 1,134 independently stored emotion records.

### Independent controls

| Control | Existing representation / proposed UI | Meaning |
|---|---|---|
| Felt state | `felt_layers` with one dominant selection and compatible secondary layers | The character's interior appraisal and action priority. |
| Felt intensity | Integer 1–7 on each selection | How strongly the state organizes the moment. |
| Displayed state | Optional `displayed_selection` | A separately selected outward presentation; required for masked/performed regulation. |
| Display allowance | `display_allowance`, 0–1 | How much outward expression is permitted. Keep this separate from the seven-level feeling scale. |
| Regulation | `open`, `restrained`, `suppressed`, `masked`, `performed`, `conflicted` | How the person manages expression. |
| Arousal | Optional `arousal_override` | Editorial energy; leave unset unless authored. |
| Vocal loudness | Existing voice-region selection/override | Relative audible level. Do not invent a new top-level schema field without a deliberate migration. |
| Duration | Line/clip time and beat coordinates | Timing, independent of emotional depth. |

### Seven levels

| Level | Label | Editorial meaning |
|---|---|---|
| 1 | Trace | A brief change of attention; outward evidence may be minimal. |
| 2 | Mild | The state recurs while ordinary tasks remain easy. |
| 3 | Clear | It organizes a recognizable choice, rhythm or response. |
| 4 | Strong | It competes noticeably with ordinary attention. |
| 5 | Intense | It shapes priorities and requires effort to contain or channel. |
| 6 | Consuming | It dominates the current task and narrows other concerns. |
| 7 | Overwhelming | It defines the moment's subjective salience. It does not require shouting, tears, collapse or violence. |

Use the actual authored level description and variant modifier. Do not fabricate seven levels by attaching “slightly,” “very” and “extremely” to a single cue. A high-intensity confession or breakdown ladder is an optional named acting preset, not a universal emotional law.

### Regulation and mixtures

Open expression follows the authored felt state. Restrained expression selects its contained alternative. Suppression keeps outward behavior economical. Masking and performed display require an explicit displayed selection. Conflict distributes opposing impulses across compatible channels or successive beats; it does not average two complete faces into one result.

Secondary layers contribute subtext, objectives or compatible cues. They do not stack a second full face, voice and body preset onto the same instant. Report incompatible directions and preserve the dominant dramatic intention.

<!-- chapter: cues | Face, voice & body | 05 / THE OBSERVABLE PERFORMANCE -->
## Thirty-two regions. A few meaningful choices.

Every catalog state includes baseline face, voice and body descriptions, seven levels, timing, restrained alternatives, recovery, playable direction and candidate cues. The catalog explorer exposes the supplied details. The compiler chooses a small compatible set for the actual shot.

### Face · 10 regions

| Region key | What to direct |
|---|---|
| `brows_forehead` | Inner/outer brow lift, gathering or release; where the tension starts and when it softens. |
| `eyelids` | Upper/lower lid exposure or bracing in relation to attention and effort. |
| `gaze` | Specific target, duration, avoidance, return and change of focus; preserve established eyelines. |
| `blink` | A delayed, ordinary or released blink tied to a thought; avoid mechanical repeated blinking. |
| `cheeks` | Tension or lift associated with the mouth, breath or expression, appropriate to the individual face. |
| `nose_nostrils` | Comfortable breath-related changes when visible; no compulsory flare. |
| `lips_mouth` | Opening, pressing, corners, hesitation and articulation. Speech takes priority over a sealed-mouth cue. |
| `jaw_chin` | Setting, release, tremor or chin position without freezing the spoken line. |
| `head_neck` | Inclination, alignment, turn and release; avoid repeated extreme neck poses. |
| `complexion` | Context-dependent appearance under the scene's light; no mandatory color change as an emotion test. |

### Voice · 11 regions

| Region key | What to direct |
|---|---|
| `pitch_register` | Relative low/middle/high placement within the established speaker's range. |
| `pitch_range_contour` | Breadth and rise/fall of pitch across a phrase; contrast and arrival. |
| `loudness` | Near-silent, soft, conversational or projected delivery suited to distance and intention. |
| `tempo_rhythm` | Rate, acceleration, unevenness, phrase grouping and tempo changes. |
| `stress` | Which authorized words carry contrast or intention. |
| `articulation` | Clarity, consonant/vowel treatment and precision while retaining intelligibility. |
| `resonance` | Rounded, forward, chest-led or lighter placement as editorial language within identity. |
| `texture` | Grain, breathiness, dry edges or fragility where compatible with the reference voice. |
| `breath_phrasing` | Inhale placement, phrase support, recoveries and exhalation; no forced physical distress. |
| `pauses` | Listening, hesitation, realization and response space rather than random punctuation. |
| `nonverbal_vocalizations` | Only specifically authorized and authored laughs, cries, gasps or other vocal sounds. |

Do not treat relative pitch or loudness language as guaranteed acoustic measurements. A voice reference fixes identity; it does not require the reference recording's emotional delivery to be copied into every new line.

### Body · 11 regions

| Region key | What to direct |
|---|---|
| `head_neck` | Orientation to a partner or event, compatible with the facial cue. |
| `shoulders` | Protective gathering, release, asymmetry or controlled stillness. |
| `chest_torso` | Breath, lean, openness, recoil and relationship to support. |
| `arms_elbows` | Reach, containment, preparation, yielding and space occupied. |
| `hands_fingers` | Grip, release, hesitation, contact, prop handling and fingertip precision. |
| `pelvis_weight` | Center of support, shift, balance and commitment to move. |
| `legs_feet` | Stance, foot placement and support when the frame can show them. |
| `gait` | Initiation, pace, direction, stopping and recovery when authored and visible. |
| `proxemics` | Distance between people, boundaries, approach and retreat. |
| `touch_props` | Named contact participants, pressure, support and continuity of objects. |
| `stillness` | Active held intention, listening or refusal; stillness is not absent acting. |

### Regional overrides

Each region uses **Inherit**, **Omit** or **Replace**. Inherit uses the effective catalog and scope. Omit withholds the cue. Replace supplies an explicit instruction that still passes framing, dialogue, sound-permission and contradiction checks.

Resolve lip articulation before mouth tension, identity before intensity modifiers, physical support before expressive collapse, and source framing before invisible body detail. Do not move the camera merely to display a newly selected cue.

<!-- chapter: beats | Beats & inheritance | 06 / A PERFORMANCE THROUGH TIME -->
## A beat changes. A character continues.

Resolve settings in this order: **runtime default → scene default → character override → line override → beat override**. Record the winning scope for each effective field. Explicit per-region modes control whether an inherited instruction survives.

| Scope | Owns | Boundary |
|---|---|---|
| Character baseline | Identity, visual/voice reference, accent/language, mobility; `identity_locked: true` | Emotional change cannot replace the person. |
| Scene | Shared physical situation, regulation, framing and sound policy | Does not assign one identical objective to every character. |
| Character in scene | Felt layers, objective, relationships and physical context | Does not rewrite dialogue. |
| Line | Exact `spoken_text`, duration, authored sounds and performance | Speech stays separate from direction. |
| Beat | Valid timing plus localized performance overrides | Cannot change narration, extra-dialogue or nonverbal-sound permissions. |

### Temporal arc

Give the performance an **onset, escalation, apex, recovery and carryover**, when appropriate. A clip can begin in an already active emotion. A line's final silence is still part of the performance: the speaker receives the partner's response or remains with the admission.

Beat timing uses the existing `seconds`, `normalized` or `text_codepoints` coordinate systems. Validate start/end order, bounds and anchors. Character-codepoint anchors are not interchangeable with JavaScript UTF-16 offsets. Text anchors should identify the intended occurrence when a phrase repeats.

### Continuity

Use `continuity.from_line_id` and `restart_onset` to distinguish continuation from an authored restart. Preserve incoming face/body state, breath, position, costume, dirt, wetness, injury, objects, contact and knowledge. A scene boundary only resets fields the story actually changes.

Define the endpoint of a physical action. If a character is already kneeling, the next clip begins there; it does not repeat the impact. If a coin is in a pouch, a new angle does not create another toss. These are examples of general state continuity, not requirements for unrelated movies.

### Silent reaction contract

Keep `spoken_text` empty and use `silent_reaction` where applicable. The voice cue budget is zero. Authored permissible ambient sound is separate from an improvised vocal event. Preserve listening targets and the incoming state without manufacturing speech to fill duration.

<!-- chapter: camera | Camera & material world | 07 / WHAT THE SHOT CAN HOLD -->
## The camera serves the authored moment.

Start from the approved shot plan. Preserve varied coverage: establishing views, medium shots, over-shoulder compositions, two-shots, reverses and close-ups when the story requires them. Avoid featured full-body shots unless explicitly requested or necessary to show an action.

### Current cue budgets

These are existing code defaults in `FRAMING_BUDGETS`. A reviewed override can refine the budget without making invisible cues visible.

| Framing | Face | Voice | Body |
|---|---:|---:|---:|
| Extreme close-up | 2 | 2 | 0 |
| Close-up | 2 | 2 | 1 |
| Medium | 2 | 2 | 2 |
| Wide | 1 | 2 | 2 |
| Audio only | 0 | 3 | 0 |
| Silent reaction | 2 | 0 | 2 |

The current code includes a close-up fallback. R4 requires an explicit integration step to resolve framing from the selected coverage plan before compilation. Surface a missing source or a reviewed override; do not pretend the fallback is an approved camera decision.

### Camera vocabulary and axes

| Instruction | Meaning |
|---|---|
| Dolly in / out | Translate the camera toward / away from its subject; perspective changes. |
| Truck / track | Translate laterally along a specified path and subject relationship. |
| Pedestal | Raise/lower the camera position; distinct from looking up or down. |
| Pan / tilt | Rotate horizontally / vertically from the camera position. |
| Orbit | Travel around a subject on a specified arc; state start and end positions. |
| Rack focus | Change focus plane; no implied camera travel. |
| Zoom | Change focal length; do not use as a synonym for dolly. |

For the internal camera profile, document **Tx positive = screen-right truck; Ty positive = upward pedestal; Tz positive = dolly toward the subject; negative Tz = dolly away**. Map this convention explicitly to the actual renderer's coordinates. Public prompts use readable camera language.

One run, no rear-follow, a tight contact two-shot, static dialogue or a no-roll rule can be useful scene presets. They are not universal rules of film grammar or established mathematical guarantees about model internals.

### Optics, lighting and matter

Keep lens/perspective intent, camera height, focus, lighting direction, time/weather, exposure mood, atmosphere, surface texture, costume and props consistent. Style words should reinforce observable choices. An identity plate remains a casting reference; the scene frame supplies the composition and may include multiple people.

Do not encode speculative explanations about latent frames, camera “bandwidth” or attention competition as hard validation. Use actual adapter capability, observed behavior and explicit creative constraints.

<!-- chapter: audio | Voice, sound & score | 08 / IDENTITY IN THE VOICE -->
## One person. A new performance.

The production policy is **approved voice identity references with dialogue generated natively by the audiovisual model**. Cueboard controls the delivery of the new authorized line. It does not create a separate film-dialogue TTS job or silently switch to an audio-to-video fallback.

Reference creation/design tools may remain available for preparing voices. Their existence does not authorize generating every film line separately. A Qwen voice profile can describe architecture; the actual reference bytes, speaker binding and approval establish the usable reference.

### Reference identity contract

Bind the exact character or ensemble member, selected reference iteration, revision, canonical media URI and byte hash. Keep `previewUri` for playback only. Deletion, changed bytes or a changed selection invalidates the affected approval; never silently pick another approved voice.

| Path at the inspected commit | Voice-reference-only status |
|---|---|
| Direct H3 Ref2VA | Implemented joint reference path; must validate the actual model/conditioning ancestry, image/audio bytes, bindings and all saved outputs. Real inference remains unverified in this document. |
| H3 FL2VA | Not supported by the current joint voice-reference capability check. |
| LTX supplied-audio conditioning | Not treated as voice-identity-only generation by the current adapter. |
| LTX Director | Existing video workflow capability does not imply voice-reference-only support. |
| H3/LTX text prompt preview | Useful authoring output; it does not grant execution capability. |

The current H3 joint path has its own speaker, audio-duration and node-schema restrictions. Read and enforce them from the current adapter. Do not substitute general model marketing limits or a UI toggle for executable support.

### Audio permissions

The generic compiler defines `allow_narration`, `allow_extra_dialogue` and `allow_nonverbal_vocalizations`, all defaulting to false. **The current production draft integration is stricter:** `makePerformanceDraft()` rejects any enabled flag, nonempty allowed-sound list or authored sound event anywhere in a proposal. Do not display these as currently usable production permissions.

In the generic compiler contract, `allowed_sound_events` identifies permitted kinds and an actual event also needs an authored kind, onset, duration and direction where appropriate. A permitted laugh does not create a laugh automatically. Background chant, crowd speech, ambience and foreground lines require their own intentional treatment.

**Revised specification, if needed by an approved screenplay:** add narrowly scoped, source-bound support for an explicitly authored sound event rather than weakening the production guard globally. This requires integration changes and regression tests. Keep the user's no-narration policy intact; AI proposals cannot invent extra speech or enable permissions. Beat overrides cannot escalate permission flags. Existing workflow ambience is distinct from newly invented Cueboard events.

### Score planning

Choose no score, native score direction or a separately composed/assembled continuous score. Silence is not the same instruction as quiet cello. Give cues entry, exit, emotional function, motif, instrumentation and mix priority where useful. A cue budget is a project preference, not a universal ratio of music to runtime.

Repeating a motif description in independent generation prompts does not prove melodic continuity. When exact continuity is required, use the existing post-production score and assembly path. Preserve dialogue clarity and source-approved sound events.

<!-- chapter: compilation | Prompt compilation | 09 / FROM STRUCTURE TO LANGUAGE -->
## Write the performance once. Adapt it deliberately.

Keep rich structured data internally. The audiovisual model receives a focused rendering of what matters in the selected clip. Raw JSON, rule IDs, numerical catalog dumps and warnings are not a second prompt.

### Compile order

1. Resolve the approved screenplay version, selected line/silent beat and source IDs.
2. Validate schema, catalog versions, character baselines, selection IDs and timings.
3. Merge scopes; resolve felt/displayed states, regulation, allowance and physical context.
4. Resolve actual shot framing, cue budgets, visibility and region overrides.
5. Apply continuity, speech articulation priority, compatibility and sound permissions.
6. Select deterministic or seeded cue IDs under the existing policy.
7. Produce protected speech, visible action, vocal delivery, authored sounds, warnings and trace.
8. Serialize for the selected engine/mode; preserve the exact authorized text once.
9. Validate required references, supported workflow path and all intended saved outputs before execution.

### Existing output contract

| Field | Contents | Consumer |
|---|---|---|
| `spoken_text` | Exact authorized words; empty for a silent beat. | Speech portion of the engine adapter. |
| `video_direction` | Permitted observable face/body action. | Visible action in the selected prompt. |
| `delivery_direction` | Pitch, loudness, tempo, articulation, texture, breath and pause direction after filtering. | Speaker delivery outside spoken text. |
| `sound_events` | Authored, allowed, timed events. | Soundscape adapter. |
| `performance_json` | Resolved settings, selected cue IDs, beat outputs and notes. | Persistence, review and debugging. |
| `warnings` | Withheld contradictions, timing conflicts and review concerns. | Human-facing review. |
| `unsupported_controls` | Unsupported feature, status and reason. | Capability/readiness review. |
| `resolution_trace` | Catalog version, profiles and winning scopes. | Provenance and reproducibility. |

### LTX prose profile · revised specification

Produce coherent cinematic prose with concrete action, the established setting/composition, essential physical performance, exact quoted speech and relevant audio. State camera changes deliberately. Keep the scene's logical progression; do not pile every region description into the output. The earlier nine-header/numerical examples remain historical and do not override this selected profile.

### H3 profile · explicit implementation work

The inspected mapper currently assembles labeled acting, delivery and exact-dialogue text. A proposed three-field profile separates the main audiovisual prompt, overall soundscape and non-diegetic music. Map those fields to the actual installed workflow; do not assume an arbitrary JSON shape is an executable request.

Where the selected H3 prompt syntax supports it, the main prompt places exact speech in the documented language-tagged form, with speaker identification and delivery outside the tag:

```text
Mara speaks softly after a controlled breath: <d>[English] I came back.</d>
```

This is a generic formatting example, not added screenplay content. `non_diegetic_music: N/A` represents the selected no-score profile. Preserve any required I2V alignment prefix. A heuristic about starting with a verb must not override the actual mode's syntax.

### Speech and timing locks

Never change “I've” to “I,” substitute punctuation, duplicate the line, narrate an instruction or add a concluding phrase. Keep speech tags, pauses and actor directions out of `spoken_text`. If the authorized line cannot fit the chosen engine duration, surface it for an approved split or timing decision. Do not speed up or rewrite the line silently.

Do not reuse a 20- or 22-second editorial segment unchanged when the selected backend accepts a shorter clip. Preserve editorial timing and generation timing as separate related values.

<!-- chapter: implementation | Electron implementation | 10 / BUILD ON WHAT EXISTS -->
## Keep Premiere316 an Electron application.

This handbook is an implementation reference. The standalone HTML is a document reader, not a new app shell. Preserve the existing Electron main/preload/IPC boundaries, React/TanStack renderer, project storage, local media, ComfyUI workflows and production navigation.

### Core files at the baseline

| Concern | Existing source |
|---|---|
| Full catalog | `public/data/emotion_catalog.json` |
| Config schema | `src/data/emotion-node-config.schema.json` |
| Types, scopes and compiler | `src/lib/emotion/types.ts`, `merge.ts`, `compiler.ts`, `cue-policy.ts`, `constants.ts`, `validation.ts` |
| Performance UI | `src/components/performance/emotion-performance-panel.tsx`, `performance-workspace.tsx`, `joint-performance-workflow.tsx` |
| Approved source and versioned drafts | `src/lib/emotion/integration.ts`, `review-api.ts`, `review-guard.ts` |
| Joint native generation | `src/lib/emotion/joint-generation.ts`, `joint-api.ts`, `joint-api.server.ts`; `desktop/joint-workflow.mjs` |
| Voice identity and persistence | `src/lib/studio/character-voice-designs.ts`, `voice-reference.ts`, `voice-design-library.ts`, `voice-reconciliation.mjs`, `project-storage.ts` |
| Director and shot configuration | `src/lib/studio/director-scene-authoring.ts`, `director-workflow-editor.ts`, `director-image-guides.ts`; `desktop/director-compiler.mjs` |

### Human-readable Cueboard controls

Improve the existing performance panel using the same schema and state store. Let a user select a scene and exact line, inspect the source, edit the hierarchy/intensity/regulation and regional controls, see inheritance and framing, compare a proposal, and save/apply a version. Keep expert JSON available as a secondary view. Do not create a second catalog, second project store or parallel approval system.

### AI review and proposals

AI reviews the approved screenplay context and character/shot information, then returns editable versioned proposals. Keep the source hash, selected lines and revision. Do not silently load a different writer, truncate context, or make a simulated response look real. Manual editing remains usable if the configured writer is unavailable.

Preserve `approvedPerformanceSource`, `makePerformanceDraft`, `isPerformanceDraftStale`, `applyPerformanceDrafts` and `undoPerformanceDraft`. Exclude deleted screenplay nodes and descendants. Changing the source invalidates dependent proposals and tickets. Late asynchronous responses must not restore old approval or replace newer user edits.

### Execution and storage

Revalidate before submission. Review tickets must still match the applied draft, selected lines, workflow, reference identities and bytes. Validate the actual positive-conditioning path and every submitted saved output. A valid intermediate branch cannot hide an invalid final branch.

Preserve signed receipts, deleted-reference records, ensemble member identities, media paths, job recovery and project-local generated clips. A finished generation remains a take to review; it does not become canonical automatically.

No special ComfyUI node is implied solely by the existence of this handbook. Use the app's existing compiler and supported workflow inputs. Add a custom node only for a concrete missing execution capability, with an explicit typed boundary and tests.

<!-- chapter: acceptance | Implementation gates | 11 / WHAT DONE MEANS -->
## Reviewable behavior, not another promise.

The companion implementation prompt maps these requirements to the inspected code. Its work stays inside the current Electron architecture. Cosmetic document changes do not trigger a screenplay migration or replace project media.

### Incremental delivery

| Stage | Deliver | Acceptance |
|---|---|---|
| 1 · Contract | Scoped R4 rules, current schema/capability comparison and conflict decisions. | Existing source is distinguished from new work; no duplicate catalog or state store. |
| 2 · Compiler | Framing inheritance, independent emotional controls, continuity and versioned serializers. | Exact speech and source identity survive; unsupported controls are visible. |
| 3 · Existing Cueboard panel | Structured controls, inheritance, source status, proposal comparison and expert JSON. | Drafts remain editable/versioned; stale proposals cannot apply. |
| 4 · Reference execution | Honest native reference capability and real-byte/member validation. | Unsupported modes fail clearly; no separate dialogue TTS fallback. |
| 5 · Persistence and verification | Reload recovery, focused tests, typecheck/build and Electron browser checks. | Report what passed and what still requires real inference. |

### Meaningful regression cases

- Overwhelming quiet grief stays quiet and does not invent tears, screams or self-striking.
- Masked/performed regulation requires an explicit displayed state.
- A wide or medium source shot keeps that framing; invisible cues are withheld.
- Mouth articulation can proceed while an incompatible lip-press instruction is withheld.
- A silent reaction keeps empty speech and zero voice budget; permission alone creates no event.
- Exact words appear once in each final engine text; codepoint anchors resolve correctly.
- Character identity, mobility and reference bytes survive changes of intensity and reload.
- A copied ensemble member does not inherit another member's approval.
- Deleted or changed references and screenplay content invalidate affected selections and drafts.
- Late writer/review responses and stale submission tickets cannot revive obsolete state.
- Continuations preserve contact, props, dirt, wardrobe and outgoing emotion without replaying onset.
- Required predecessor output is validated after it exists; selected-engine-only readiness is respected.
- All submitted saved outputs are validated, including branches beyond a valid intermediate.
- No separate dialogue TTS or automatic A2V fallback appears in this pathway.

Run actual repository gates, including `npm run typecheck`, `npm run build` and focused tests for changed contracts. Exercise the Electron renderer at desktop and narrow sizes, keyboard navigation, save/reload and review flows. A historical report of passing tests is not a new test run. Keep live AI/video inference marked unverified until it is actually tested.

### This document's verification boundary

The repository and source files were inspected. The source-page inventory and complete embedded catalog are mechanically checked. Local HTML browser access was blocked in this environment; document structure and interactions can be checked without claiming a rendered desktop/mobile visual pass. No application code was patched and no AI/video inference was run while preparing this edition.
