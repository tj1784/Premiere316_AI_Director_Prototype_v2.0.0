# Cueboard R4 implementation record

Source: `Cueboard_Revised_Binder_R4.zip`, SHA-256 `1318a0cf00c3fa887005d8fbb76edb2b397a6daad5b5a796a00bf979128db8c9`.
Reviewed and starting repository commit: `90c6732ba210332984a6e6aff13b9ac718419e76`.
Revision: `2026-09-19-R4`. The HTML/master and companion implementation prompt are the reconciled requirements. Original PDF pages and repeated appendices are historical provenance, not independent instructions or production content. The supplied document's historical verification is not counted as a new application test.

## Contract audit and changes

### User amendment: scene first frame only (2026-09-19)

Scene generation requires one approved first frame only. Last-frame images, prompts, pairs and approval are not required and must not block scene generation. This amendment supersedes conflicting frame requirements in the original binder and earlier implementation notes. The production master and the Downloads HTML bible are updated together. This is a documentation change; it does not claim that all application generation gates have been changed.

The existing catalog is complete: 10 families, 57 subfamilies, 81 states, 162 variants, seven state levels and seven modifiers per variant, and 32 baseline regions. The R4 regression audits every record. No catalog, identity, screenplay, reference or project-content migration was needed.

The existing schema already separates intensity (integer 1–7), display allowance (0–1), regulation, displayed state, arousal and regional vocal loudness. The compiler now honors an explicitly displayed selection outside masked/performed regulation too. Automatically selected volume/extreme-action options are withheld for explicit regional authoring; no intensity increase grants speech, sounds, tears, contact or violent behavior. Detailed catalog options remain intact. This prose filter is conservative editorial assistance, not a proof that a generative model will obey every physical constraint.

Framing resolves from exactly linked canonical shot dialogue when available, otherwise unambiguous scene coverage, otherwise legacy scene shot sizes. Mixed/unrecognized coverage is reported; it is never arbitrarily reduced to the first shot. Existing scene/character/line overrides remain explicit higher-priority choices. A missing source keeps the historical visibility-budget fallback but no longer emits an instruction to shoot a close-up. The form identifies the source and effective framing. Canonical coverage and Director plans now participate in draft staleness and writer-context projection. Source changes require fresh review; old saved drafts are retained.

Production sound guards remain unchanged. The schema already rejects beat permission fields; direct resolver calls now also reject escalation. Silent reaction templates retain their real beat/character source and explicitly select silent reaction framing. Empty speech produces no selected voice cues, even with an authored voice replacement. Per-region trace now records the winning scope as well as the existing top-level trace.

`serializers.ts` exports explicit `ltx-prose-1` and `h3-ref2va-1` profiles. Compiler-produced cinematic text is separate from diagnostic text: internal IDs, numeric editorial scales and packets do not enter engine prose. Exact dialogue is inserted once, Unicode and newlines intact. Directions containing a duplicate protected line fail closed. The H3 profile places the speaker outside `<d>[Language] …</d>` and renders the three sections into the existing node's STRING prompt; it does not invent graph sockets. English is this profile's fallback when a baseline language is absent. Source speech containing reserved markup is rejected instead of rewritten. Existing base-prompt soundscape/music sections are preserved and duplicate sections rejected; no score is `N/A`. Picture/audio alignment tags remain bound to the existing indexed Ref2VA sockets. Timed beats and unsupported controls are reported in preview and live review findings. Existing legacy drafts require an explicit new validated version before these serializers can be used.

The existing Performance panel now supports manual scene drafts without a writer, scene/character/line editing, felt layers and variants, seven intensities, displayed selection, regulation, normalized display/arousal, objective/appraisal/relationship/physical context, framing inheritance, all regional modes, cue IDs and continuity links. Timed beat editing remains in secondary Expert JSON using the same schema. Drafts save as new versions; compare, apply, unapply and restore use the existing state/history. Source changes during editing reject the save. Writer responses arriving after version changes are discarded. Merely opening a panel does not save a draft or invoke inference.

Joint reference reads now use canonical media URIs; playback previews do not select generation identity. Runtime byte/hash verification remains in force. The main/preload runtime, navigation, generation settings, member approvals, tombstones and review-ticket machinery are preserved.

## Rule register

The `historical:*` identifiers below are local provenance aliases assigned to conflicting historical guidance, not IDs claimed to exist in the original PDF. All rules have revision `2026-09-19-R4`.

| rule_id | scope | status | supersedes | effective decision |
|---|---|---|---|---|
| CB-R4-01 | generic Cueboard | enforced + editorial review | historical:intensity-means-volume | Felt/display/arousal/voice remain independent; extreme catalog options require explicit authoring. |
| CB-R4-02 | production compilation | implemented | historical:universal-closeup | Resolve source coverage; report ambiguity and explicit overrides. |
| CB-R4-03 | engine text | implemented | historical:dialogue-in-directions | Exact protected speech once; duplicate or unrepresentable markup fails closed. |
| CB-R4-04 | selected engine profile | implemented; inference unverified | historical:ltx-nine-headers | Versioned prose/H3 text serializers, distinct from packets and capability checks. |
| CB-R4-05 | native joint generation | preserved | historical:tts-fallback | Direct H3 Ref2VA only; no separate film-dialogue TTS or A2V fallback. |
| CB-R4-06 | identity/composition | preserved | historical:single-person-scene | Identity plates do not limit scene compositions; existing reference graphs remain authoritative. |
| CB-R4-07 | selected workflow | preserved runtime gates | historical:all-engine-assets-required | Do not create a new PREV_LAST execution mode from document prose or demand unused engine inputs. Validate actual connected graph outputs. |
| CB-R4-08 | authored continuity | existing envelopes + explicit line controls | historical:reset-on-scene | Keep canonical IN/OUT physical state and authored context; continuation does not replay onset. No bulk continuity rewrite. |
| CB-R4-09 | future numeric camera adapters | documented convention | historical:positive-tz-ease-out | Local Tx positive is screen right; Ty positive is up; Tz positive approaches subject, negative recedes. |
| CB-R4-10 | project/scene presets | scoped | historical:scene18-universal | Father-running, static dialogue, no rear-follow, cello, aspect ratio are authored presets, not universal validators. |
| CB-R4-11 | role authoring | supported via existing text fields | historical:mandatory-tragic-history | Explicit “not applicable” with role reason is valid; do not fabricate biography. |
| CB-R4-12 | score planning | implemented serialization / existing post-production | historical:quiet-cello-is-no-score | Preserve authored score; N/A means none. Exact continuity is post-production work. |

## Boundaries retained

The current production path still rejects narration, extra dialogue, nonverbal vocalization permissions, allowed-sound lists and authored sound events. A future source-linked sound exception needs separate approval mapping and tests; this implementation does not enable it.

H3 FL2VA and LTX voice-identity-only generation remain unsupported. Text serialization is not measured inference support. No model was loaded and no writer/video/audio inference was run. Exact engine timing, audiovisual quality and continuous score are unverified. Timed beat execution is explicitly an unsupported control of these text profiles.

No existing numeric Tx/Ty/Tz serialized adapter was found in the Cueboard/Director execution boundary. The camera convention is documented rather than silently interpreting or reversing existing movement strings. Likewise `PREV_LAST` is not an existing literal Cueboard runtime mode; this change does not falsely authorize one. Actual native/Director graph ancestry and saved-output validation remain unchanged. Authored continuity envelopes remain the physical-state authority; the text compiler does not infer contact mechanics or backstory.

## Verification

Run `node --experimental-strip-types --test src/lib/emotion/*.test.ts` plus the listed reference, persistence, performance and desktop joint/preload suites, `npm run test:authoring` (includes Director), `npm run typecheck`, and `npm run build`. Current-run results and browser artifacts are recorded in `VERIFICATION.md`. Source-file hashes in `UPSTREAM.json` retain their imported provenance; local R4 changes are explicitly recorded separately.

## Global production patch adoption

Adopted [BIBLE-PATCH-GLOBAL-001 revision 1.0](Production_Bible_Global_Patch.md) verbatim and linked its [rule register](RULE_REGISTER.md) from the master. The supplied source date is retained. This commit also includes the earlier user-requested first-frame-only bible amendment. No project registry migration, application validation, prompt rewrite or media regeneration is claimed. The local HTML bible includes the same addendum.

## Global prompt patch and Scene 18 correction

Adopted BIBLE-PATCH-GLOBAL-PROMPT-001 revision 1.0. Scene 18 now has an explicitly authored shared render description grounded in its eight supplied images and existing live-action treatment. All eight local prompts, references, settings and Auto duration flags are preserved. The delivery includes independent-shot text previews and the whole-timeline relay text reconstructed from installed source. These are payload previews, not a submitted generation. No project database migration or generated-video review is claimed.
