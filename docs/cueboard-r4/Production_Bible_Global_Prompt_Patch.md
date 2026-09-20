# Production Bible Global Prompt Patch

**Patch ID:** `BIBLE-PATCH-GLOBAL-PROMPT-001`  
**Revision:** `1.0`  
**Research date:** `2026-09-20`  
**Applies to:** All future prompt packages adopting this bible.  
**Extends:** `BIBLE-PATCH-GLOBAL-001`, especially prompt compilation and delivery validation.  
**Deliverable:** A separate, reusable global-prompt authoring and implementation contract. This document does not regenerate completed scenes or claim application enforcement is already installed.

## FINDING-GP-001 — What went wrong

The previous delivery supplied continuity notes and local prompts without a separately identified global prompt. That was a packaging and authoring omission. Turning the notes into a global prompt by adding a production-summary paragraph did not resolve their scope.

The assembled text mixed five kinds of information: shared photographic treatment, scene scheduling, workflow configuration, changing character states and instructions for the prompt writer. Those require different handling before a rendering model receives them.

| Material in the assembled example | Proper destination | Reason |
|---|---|---|
| Photorealistic live action and historical setting | Shared visual description, when applicable throughout its scope | These describe the intended visible world. |
| Eight shots, total runtime and frame rate | Timeline and generation configuration | Whole-scene scheduling must not become the story of every independent clip. |
| First-frame-only mode and predecessor dependencies | Workflow and reference bindings | The actual inputs and execution graph establish the mode. |
| Falling, running, remaining grounded and later rising | Local action and continuity states | These happen at particular times; they are not constant scene properties. |
| Preserve the exact posture and expression | Initial-state binding, followed by authored development | The opening pose must not become a command to retain one expression throughout the take. |
| Entire cast roster and costumes | Character registry, filtered by the current shot | Mentioning every person in every render can conflict with a face-only or single-person composition. |
| Music absent in some shots and present in others | Scoped audio cues resolved per request | The renderer needs the current clip's sound, not an unresolved schedule. |
| Follow the bible and the Day-Lewis example | Authoring instructions and performance references | The writer must turn those sources into specific observable acting. |

These are instruction-scope problems and plausible failure mechanisms. They are not claims that an uninspected video has already demonstrated every failure.

## EVIDENCE-GP-001 — Research basis

The following are primary sources. The architecture proposed below is a production recommendation derived from them and the project requirements; it is not a universal vendor feature called a global prompt.

| Source ID | Explicit guidance and its scope |
|---|---|
| `SRC-GP-LTX-PROMPT` | LTX describes prompts through shot, scene, action, character, camera and audio. It supports different structures for continuous takes and multishot generations, with detail matched to complexity. [LTX 2.5 prompt guide](https://ltx.io/blog/ltx-2-5-prompt-guide) |
| `SRC-GP-LTX-I2V` | LTX I2V uses the image as its visual starting point and directs text toward movement, camera and audio. Resolution, length and frame rate are configured separately. [LTX image-to-video guide](https://docs.ltx.io/open-source-model/usage-guides/image-to-video) |
| `SRC-GP-RUNWAY-I2V` | Runway Gen-4 emphasizes motion and positive, direct descriptions; it warns that heavily restating the image can reduce motion or produce unexpected results. This is model-specific guidance. [Runway Gen-4 prompting guide](https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide) |
| `SRC-GP-H3-BASE` | H3's base guide uses mode-specific frame alignment and three core sections. It establishes the initial image anchors and develops a chronological audiovisual sequence. [Official MiniMax H3 base guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md) |
| `SRC-GP-H3-REF` | H3 full-reference rewriting has six sections, consistent media labels and a short overall-style opening before the shot sequence. Its detailed description follows playback order. [Official MiniMax H3 reference guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md) |
| `SRC-GP-H3-API` | The documented H3 API supplies text and role-bound media through request content, with generation settings separately specified. [MiniMax video generation API guide](https://platform.minimax.io/docs/guides/video-generation) |

## RULE-GP-001 — Define what global means

Use **global render description** for reusable audiovisual properties that genuinely apply across a declared collection of shots. Store it as a `GLOBAL_PROMPT` record. Its scope may be a film, a sequence or a scene; scope must be explicit.

A **production instruction** tells the authoring model how to work. A **global render description** describes shared screen and sound qualities. A **local prompt** directs the current action and performance. A **generation configuration** sets executable parameters. Keep these records distinct, then compile the relevant content for the actual provider and mode.

An application field named `global_prompt` does not prove how the backend consumes it. Inspect the selected workflow's implementation or emitted payload before declaring that the field is prepended, appended, separately encoded, time-conditioned or otherwise inherited. Record that behavior in the engine profile.

If a workflow genuinely accepts a whole-timeline description alongside timed local conditions, use its documented semantics. Do not force an independent-clip prefix design onto a different conditioning system.

## RULE-GP-002 — Develop the global description from approved sources

1. Resolve the project bible, visual treatment, location and lighting records, material references and audio policy by their existing IDs and revisions.
2. Identify which attributes are valid in every shot within the proposed scope. A daytime exterior and a candlelit interior may share material treatment but require different lighting contexts.
3. Express those attributes as visible or audible properties: photographic realism, skin and material texture, palette, contrast, light quality, atmosphere and sound perspective where invariant.
4. Separate changes into scoped context records. Do not make time of day, weather, a score cue or a costume state universal when the story changes it.
5. Compare the resulting description with the actual reference images. A global instruction must not contradict the image selected for an I2V take.
6. Preview its combination with every affected local prompt before generation.

Do not invent an aesthetic merely to fill a template. Unsupported properties remain unresolved in authoring metadata or are omitted when nonessential.

## RULE-GP-003 — Keep the shared layer focused

Eligible content includes the approved visual medium, relevant period/world treatment, material realism, color and contrast treatment, applicable optical character, and genuinely shared acoustic qualities.

Conditional content includes location, lighting, weather, costume state, recurring subject anchors, ambience and music. Include it only where its declared scope matches the current request.

Keep the following outside a reusable renderer description:

- Whole-film or whole-scene plot summaries, editorial shot counts and total runtime.
- Future or completed story events unrelated to the current clip.
- Every character's identity and wardrobe regardless of who is visible or audible.
- Fixed facial expressions, poses, camera angles, focal lengths or moves that conflict with local coverage.
- Exact dialogue assigned to other clips.
- Instructions to consult an unseen bible, prior conversation or acting exemplar.
- Review checklists, reference-recovery procedures, approval instructions and packaging notes.

A deliberate single multishot generation is a separate case: its prompt may describe its complete supported timeline. Do not copy that timeline into each independently generated shot.

## RULE-GP-004 — Preserve performance depth in local prompts

The global layer cannot do the acting work. Retrieve the character sheet and current state for each featured participant, then write the thought as an observable sequence: attention, attempted control, hesitation, physical choice, partner response and aftermath where relevant.

Keep the detailed causal performance standard established in `RULE-GPB-007`. Economy in the shared description does not authorize stripping local prompts down to generic motion. A silent actor still processes, resists, receives or deliberately withholds a response.

Translate the Day-Lewis benchmark into precise timing, muscular effort, breath, vocal texture and carried emotion. Do not send only the actor's name or an instruction to perform at that level. Match expression intensity to the actual scene; a shared style must not suppress an authored breakdown or force one into quiet listening.

## RULE-GP-005 — Preserve camera dynamics locally

The global visual treatment may establish an overall photographic character. The local camera plan specifies starting frame, subject, path, timing, focus changes, landing composition and purpose.

Do not substitute general words such as cinematic or dynamic for the actual move. Do not impose a constant close-up, fixed lens, static frame or orbit on every shot. Show the significant acting detail at the moment it matters, while preserving world geography.

Initial-image consistency applies at the beginning. The shot must then develop through its authored movement, expression, contact and camera changes. Preserve identity and physical consequences while allowing the performance to evolve.

## RULE-GP-006 — Resolve layers before serialization

Use this production hierarchy, subject to active user instructions and source authority:

`project look → scene context → current character and continuity state → authorized shot and beat overrides → model/mode serializer`

This is field-level resolution, not blind string concatenation. A scoped exception replaces the inherited value in that scope. For example, when an authorized local cue introduces cello, the compiled request must not simultaneously carry a global unscored instruction.

Scope and authority are separate: a local suggestion cannot override an approved identity or exact line merely because it is more specific. Report genuine conflicts and resolve them from the governing source.

Compile one coherent current request. Deduplicate repeated facts and dialogue, remove irrelevant cast and events, preserve the local performance and include only media labels that actually bind to supplied inputs. Do not rely on the video model to resolve internal contradictions.

## RULE-GP-007 — Use model-specific formats

### PROFILE-GP-LTX — LTX

For an independent I2V take, let the image establish the opening and give the text a clear progression of action, camera and sound. A continuous shot can use connected prose; intentional multishot output needs explicit transitions and renewed framing. Adapt prompt length to useful detail and the actual mode rather than padding a fixed template. [LTX prompt guide](https://ltx.io/blog/ltx-2-5-prompt-guide)

Keep API or node settings separate from narrative prose. Verify the actual merged text and any enhancer output. Do not silently alter an existing enhancer setting; preserve exact words and source scope through any authorized rewrite. The documented I2V workflow exposes frame count and frame rate as configuration. [LTX I2V guide](https://docs.ltx.io/open-source-model/usage-guides/image-to-video)

### PROFILE-GP-H3-BASE — MiniMax H3 base modes

Use the applicable alignment instruction followed by `integrated_multimodal_description`, `overall_soundscape` and `non_diegetic_music`. Put style and opening anchors at the start of the description, then advance the performance. Keep authorized speech inside the documented dialogue syntax and delivery outside it. An I2VA opening anchor does not freeze subsequent movement. Use the exact current mode's guide; do not substitute another vendor's format. [H3 base guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)

### PROFILE-GP-H3-REF — MiniMax H3 reference mode

Preserve the documented reference rewrite sections: `subject_definitions`, `summary`, `retention_analysis`, `detailed_description`, `overall_soundscape`, `non_diegetic_music`. Begin the detailed description with the brief shared style, then direct the actual shots. Bind reference labels to supplied media and keep their meanings consistent. These legitimate provider fields are different from instructions to read an unavailable bible. [H3 reference guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)

Confirm that the selected adapter accepts or correctly transforms the chosen format. Vendor documentation alone does not verify the application's wiring. The H3 API distinguishes first/last-frame media from reference media through their input roles. [H3 API guide](https://platform.minimax.io/docs/guides/video-generation)

### PROFILE-GP-RUNWAY — Runway comparison

For the cited Gen-4 I2V workflow, favor economical motion descriptions and affirmative phrasing; use the image for visual establishment. Do not turn this into a universal rule forbidding H3's documented initial anchors. [Runway Gen-4 guide](https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide)

## CONTRACT-GP-001 — IDs and source bindings

Extend the existing registry with the following record types without renaming existing entities:

| Record | Required bindings |
|---|---|
| `GLOBAL_PROMPT` | ID, revision, scope, shared text, source refs and applicability conditions |
| `SCENE_CONTEXT` | Scene ID, world/lighting/audio context, effective overrides and sources |
| `ENGINE_PROFILE` | Model, version, mode, serializer revision, global-field behavior and supporting evidence |
| `COMPILED_PROMPT` | Exact rendered text/fields, global/local revisions, reference packet, source map and configuration ref |
| `PROMPT_REVIEW` | Reviewed compiled prompt ID, checks, findings and unresolved dependencies |
| `DELIVERY_MANIFEST` | Explicit file inventory, IDs, revisions and roles |

Retain `CHR`, `CHAR_SHEET`, `CHAR_STATE`, `GEO`, `CAMERA`, `LINE`, `SOUND`, `MUSIC`, media and workflow IDs from the earlier patch. Reference IDs retrieve the actual content for the authoring system; they are not magic words that grant a renderer access to absent files.

Each compiled clause should be traceable to a source or an explicitly labeled authoring choice. Store the actual submitted payload or its reproducible representation so reviewers can confirm whether global wording reached the backend and whether it was duplicated.

## TEMPLATE-GP-001 — Authoring record

This is a template, not a populated production asset. Resolve all required placeholders before execution. The outline describes fields to author; its labels are not automatically pasted into the renderer prompt.

```yaml
id: <GLOBAL_PROMPT_ID>
revision: <REVISION>
scope_refs: [<PROJECT_OR_SEQUENCE_OR_SCENE_REF>]
source_refs: [<BIBLE_REF>, <LOOK_REF>, <APPLICABLE_ASSET_REFS>]
engine_profile_ref: <MODEL_MODE_AND_SERIALIZER_REF>
shared_render_description: |
  <Approved visual medium and applicable world treatment.>
  <Compatible material, color, contrast and optical qualities.>
  <Only those atmosphere or audio qualities shared by the entire scope.>
scene_context_refs: [<SCOPED_CONTEXT_REFS>]
local_prompt_refs: [<SHOT_PROMPT_REFS>]
reference_packet_refs: [<RESOLVED_MEDIA_AND_STATE_PACKETS>]
generation_config_ref: <CONFIGURATION_REF>
compiled_prompt_refs: [<FINAL_PROVIDER_REQUEST_TEXT_REFS>]
review_ref: <PROMPT_REVIEW_REF>
```

## EXAMPLE-GP-001 — Shared description and local performance

This fictional example demonstrates the separation. It is not a replacement for an existing scene, a newly approved look or a claim of tested output.

**Shared render description**

> Photorealistic live-action period drama with natural skin texture and tactile woven cloth, timber and stone. Muted earth colors, restrained saturation and soft highlight roll-off give the image a consistent photographic finish. Human proportions, garment weight and physical contact remain believable.

**Scoped scene context**

> A quiet stone room lit by overcast daylight through one doorway. Soft light falls from the doorway across the subject; the recess behind him remains dim. Close breathing and cloth movement sit against faint outdoor air.

**Local silent performance and camera**

> A medium close view begins with the seated man holding a folded letter against his knee. He watches the doorway, waiting for someone whose answer he fears. Footsteps approach outside. His thumb stops rubbing the paper, and his lower lip presses inward as he tries to compose himself. The camera tracks a short distance sideways toward a clearer three-quarter view, keeping the doorway on its established side. As the steps pass without entering, he nearly turns after them but checks the movement. His eyes remain on the empty opening while his shoulders ease only enough to release a held breath. The camera settles on his face and the hand still gripping the folded letter, allowing the unfinished expectation to remain visible.

For execution, resolve the current sound/music policy, check the actual first image and combine the relevant content through the engine profile. Do not send these headings as a supposed universal syntax. A different shot can inherit the photographic finish while receiving its own setting, cast, emotional progression and camera move.

## CHECK-GP-001 — Required acceptance checks

| Check ID | Pass condition |
|---|---|
| `GP-C01` Scope | Every shared clause is appropriate for every shot receiving it, or is filtered by an explicit condition. |
| `GP-C02` Sources | IDs resolve to the correct source revisions and selected media; invented references are absent. |
| `GP-C03` Temporal relevance | No unrelated future action, completed event or whole-scene schedule leaks into an independent clip. |
| `GP-C04` Cast relevance | Only present, intentionally entering or intentionally audible participants are directed in that request. |
| `GP-C05` Development | The starting pose/expression can evolve through the authored performance. |
| `GP-C06` Acting | The local prompt makes character-specific thought visible, including silence, and preserves needed detail. |
| `GP-C07` Coverage | The actual camera path exposes the important performance at readable scale. |
| `GP-C08` Consistency | Global, scene and local instructions resolve without incompatible lighting, score, framing, contact or state. |
| `GP-C09` Speech | Authorized words occur only in their assigned event and remain unchanged. |
| `GP-C10` Configuration | Duration, frame rate, dimensions, mode and dependencies are validated in executable settings. |
| `GP-C11` Provider format | The current model/mode serializer and real media labels are used; assumptions about global-field behavior are verified. |
| `GP-C12` Payload | The inspected outgoing request contains the intended shared context once, with no silent omission or unintended duplication. |
| `GP-C13` Delivery | The package explicitly identifies global description, local prompts, references and configuration/manifest where applicable. |

Check complete compiled prompts, not the global paragraph in isolation. Use at least two deliberately different shot types from the actual sequence to expose conflicts, then validate every affected shot. Actual video performance remains a separate output review.

## RULE-GP-008 — Mandatory delivery and adoption

Every requested prompt package must explicitly label its **Global render description**, **Local prompts** and **Execution/reference notes**. Give each an ID and revision. A Word document may contain the sections; separate files may carry them. A file titled continuity notes does not satisfy the global-prompt requirement.

When the selected backend has no independent global input, deliver the shared description for review and the fully compiled per-request prompts that actually contain its applicable content. Do not falsely describe a UI field as a native model feature.

For an archive, inspect the final manifest and contents before claiming it includes a global prompt or workflow. Name deliberately absent deliverables accurately. Deliver the requested artifact rather than telling the user to assemble missing pieces.

Adopt this patch alongside `Production_Bible_Global_Patch.md` (`libfile_145eacc4c3bc8191b9b1412d5c38c29b`) and `Cueboard_Production_Bible_R4.html` (`libfile_1b37e542e0108191a14729ab3878dd10`). Preserve existing IDs and source authority. Apply the new checks to future work and requested revisions; implementation and generation remain separate actions.
