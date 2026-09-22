# Character workspace implementation and verification

This delivery replaces the generic character reader with a dedicated working layout. It covers the character-sheet and scene-state UI described by `RULE-GPB-005`, `RULE-GPB-006` and `UX-005`; it does not certify the complete application or every Bible acceptance criterion.

Authority: `02_COMPLETE_MOVIE_SCRIPT_BIBLE.md`, character principles at lines 162–187; `RULE-GPB-005` at 605–627 and 1489–1493; `RULE-GPB-006` at 629–637 and 1495–1499; `UX-005` at 1787–1793. Related interactions follow `UX-002`, `UX-008` and `UX-015`. The user's later instructions take precedence over the Bible's suggested navigation rail: the global dock remains transparent, with icons at the top.

## Reachable workspace and implementation

Open **Characters & world** and select a character. The desktop layout contains three working columns: **References & voice**, **Character sheet**, and **Scene state**. The character picker searches names and aliases; previous/next controls traverse the cast. Locations, props and wardrobe remain available through the record-type selector, and the existing Visual development workspace remains reachable. Compact layouts provide named panel selectors.

| File | Responsibility |
|---|---|
| `src/components/studio/character-workspace.tsx` | Character selection, four sheet sections, visible missing fields, coverage overview, source dossier, revision history and shared field-edit dialog. |
| `src/components/studio/character-media-panel.tsx` | Actual reference/iteration carousel, enlargement, image import/repair, required views, voice audition controls and links to existing review workflows. |
| `src/components/studio/character-scene-panel.tsx` | Canonical scene/beat links, all participant fields, incoming/action/outgoing tabs, continuity records and existing continuity editor. |
| `src/lib/studio/character-dossier.ts` | Presentation mapping, inherited source display and source-validated, conflict-protected field edits. |
| `src/lib/studio/movie-bible.ts` | Existing canonical Bible keys, extension storage, correction history and authoring context. No competing character registry was introduced. |
| `src/lib/studio/resolved-shot-packet.ts` | Existing linked source packet and source-fingerprint freshness checks. |

## Complete character-field mapping

All 17 existing `BIBLE_FIELDS.character` keys appear once across the four sheet sections. These are canonical storage keys; readable labels and specific guidance expose the detailed Bible requirements without renaming stored fields.

| Section | Canonical key | Visible coverage |
|---|---|---|
| Identity | `Identity / role / established age` | Name, aliases, story role, age, performer/reference distinction and ensemble membership guidance. |
| Identity | `Body / visual angles / appearance` | Face, hair, beard, body, proportions, hands, distinguishing features and relevant view references. |
| Identity | `Wardrobe / props / habits` | Baseline costume, objects, habits and links; temporary condition belongs to scene state. |
| Identity | `History / source boundaries` | Authored history and wound; source limits and role-reason N/A. |
| Inner life | `Beliefs` | Authored beliefs and defensive lie, distinguished from interpretation. |
| Inner life | `Want` | Explicit **Super-objective & want** label and separate film-long/external-goal guidance. |
| Inner life | `Need` | Applicable inner change or a reason that the role requires none. |
| Inner life | `Mask` | Public behavior and deliberate concealment. |
| Inner life | `Tells` | Character-specific attention, face, breath, voice, hands, posture and pace under pressure. |
| Inner life | `Knowledge boundaries` | Known, suspected, misunderstood and prohibited anticipation. |
| Inner life | `Relationships / foils` | Related identities, bonds, status, trust, conflict and partner-specific pressure. |
| Performance | `Movement / mobility` | Baseline posture, gait, habits, established handedness and limitations. |
| Performance | `Regulation / release / recovery` | Containment, permitted expression, release conditions and residue; intensity is separate from loudness. |
| Performance | `Performance references` | Approved acting benchmarks, reference IDs, qualities to follow and identity/voice limits. |
| Voice & rules | `Voice / language / accent` | Identity/reference binding, language, accent, register, grain, rhythm and authored pronunciation. |
| Voice & rules | `Authorized speech / sounds` | Exact line references and separately authorized vocal events; silence permits no invented sounds. |
| Voice & rules | `Prohibited inventions` | Limits on new biography, dialogue, behavior, identity and period details. |

The source dossier also retains complete canonical specifications, aliases, provenance, approval/stale/blocking metadata, legacy character values and visual identity Bible content. Existing performance notes, character arc, identity invariants and continuity locks remain readable. A missing extension does not erase its source record.

## Complete participant-field mapping

All 11 existing `BIBLE_FIELDS.participant` keys appear once. Fields belong to the existing `performance:<beatId>:<characterId>` record, not to a duplicated character identity.

| Scene tab | Canonical key | Visible coverage |
|---|---|---|
| Incoming | `Incoming situation / known facts` | Current situation and knowledge. |
| Incoming | `Incoming emotional state` | Emotional state at entry. |
| Incoming | `Incoming physical state` | Fatigue, strength, injury, tears, dirt, costume and held objects. |
| Action | `Immediate objective` | Individual objective and silent participant's task. |
| Action | `Partner / obstacle` | Partner, relationship pressure and obstacle. |
| Action | `Concealed versus displayed emotion` | Interior feeling separated from visible behavior. |
| Action | `Permitted action / speech / sound` | Authorized action, exact speech and separate sound permissions. |
| Action | `Position / support / contact` | Location, attention/gaze target, support, contact and weight transfer. |
| Action | `Trigger / control / response / residue` | Causal acting sequence, partner effect and carryover. |
| Outgoing | `Outgoing emotional state` | Emotional change or deliberate persistence. |
| Outgoing | `Outgoing physical state` | Continuing injury, fatigue, dirt and costume; emotional relief does not imply physical recovery. |

**Continuity** is an additional inspection tab. It preserves source continuity locks, scene-linked asset variants, character-linked wardrobe records, complete shot `performanceIn`/`performanceOut` envelopes and exact participant continuity records, including positions, support/contact, limbs and transfer reasons. Records without a stored scene binding are labeled accordingly. Scene discovery follows canonical IDs and relationships rather than guessed name matches. Existing screenplay, performance and continuity editors remain reachable.

## Sources, editing, media and state boundaries

- A field shows its authored value/disposition or inherited source text. Inherited text is labeled **Source · review**, never automatically approved. Explicit **Missing / unresolved** takes precedence over older source text. Missing fields remain visible with an edit action.
- Authored nonempty values require a source reference or an authored-direction note. **Not applicable** requires a role-specific reason and source; it does not manufacture biography for an extra or witness.
- Opening a source-derived field preserves its displayed text and provenance. Drafts use the existing workspace-draft store. Closing retains the draft; saving records a correction and clears that field's draft. Reset restores the current saved value.
- Saves read the latest active picture and compare the field revision. A conflicting edit is rejected with the draft retained. Independent edits, project drafts, canonical assets, screenplay and completed media remain intact. History includes character and linked participant corrections with source, revision, previous value and time.
- Legacy character records and production character assets retain their existing IDs and ownership. Visual identity Bible values and linked board references remain available. No generated concept portrait is substituted for project media.
- Reference browsing and approval are distinct. The carousel includes available asset iterations/references and linked visual-board slots, with precise missing-reference states. Required view coverage remains **unverified** until actually reviewed. The existing asset workflow owns selection, import, repair and approval.
- Voice controls use the existing character voice records and approved-reference resolver. Actual audio controls appear for available recording URIs, with original-file fallback and repair/retry states. **Voice & auditions** opens the existing iteration workflow. Merely previewing a recording does not approve it.
- Character identity, selected media and temporary scene condition remain separate. Field edits flow through existing Bible extensions; `bibleAuthoringContext` and `resolveShotPacket` consume linked values. Their fingerprints make affected stored output stale without regenerating or deleting it.

## Verification evidence

Focused command:

```sh
node --experimental-strip-types --test src/lib/studio/character-dossier.test.ts
```

**Result: 6 passed, 0 failed.** The tests cover:

1. All 17 character keys exposed exactly once, with guidance.
2. Inherited canonical/legacy source displayed without authoring or approving it.
3. Explicit missing and authored overrides retained after serialization/reload.
4. Source validation and role-reason N/A validation without mutation on failure.
5. Field-level conflict rejection, independent concurrent edits, pending drafts and append-only correction history.
6. Actual authoring context and shot packets consuming goal, knowledge and dirty/injured participant state; only the linked take becomes stale, emotional calming preserves physical condition, completed media is unchanged and reload preserves the result.

Browser UAT performed on the running application:

| Observed flow | Result |
|---|---|
| **The Last Reel**: edit Super-objective & want; close/reopen draft; require source; save; switch selection; reload | Draft retained; source validation shown; saved value persisted. |
| Incoming physical state with dirt and injury; save and reload | Saved condition persisted. |
| Role-based N/A with empty reason, then valid reason | Empty reason rejected; valid reason saved and persisted. |
| Revision history after those edits | All three corrections visible. |
| Source-derived Concealed versus displayed emotion editor | Source text and provenance retained in the dialog. |
| Escape from Source dossier | Dialog closed and focus returned to its trigger. |
| Keyboard ArrowRight from Incoming | Action tab activated. |
| **The Prodigal Son**, Bread seller | Two canonical scene links and original continuity text retained. |
| Reference repair/import and Voice & auditions | Existing modals opened successfully. |
| Desktop viewport 1363 × 936 | Body measured exactly 1363 × 936; no outer-page overflow. |

These checks establish the listed interactions only. Real bundled image/audio bytes were unavailable in this browser environment, so successful playback, media inspection and approval were **not** validated. Live inference, a Windows binary, full responsive/zoom coverage and the complete application's 15 UX acceptance rules were **not** validated by this character-workspace pass.
