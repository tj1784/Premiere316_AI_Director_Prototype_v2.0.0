# Append these images and replace Scene 01 only

Give this file and the complete extracted ZIP to the local Codex working in Premiere316.

## Requested result

Use `Scene_01_Temple_and_the_Gathering_Varied_Angles.json`, `Scene_01_Shot_Plan.csv`, and `Scene_01_Updated_Screenplay.md` from this package as the new Scene 01 source. `Scene_01_Complete_Prompts.md` provides the readable global and per-shot prompts. Replace **PS-S01 only** with **16 segments, 210 seconds (3:30), 24 fps / 5,040 frames**. Keep the Temple prologue and gathering; remove the lost-sheep and lost-coin parables. Follow the supplied shot order, dialogue, images, and camera directions. Do not revive the rejected 29-clip H3 adaptation or a different screenplay version.

Append the supplied images as scene coverage. Preserve the established character identities, character boards, and approved voice references. This is a scene-data update, not a request to generate video or separate TTS.

## Implementation prompt

1. Read the current project instructions and inspect the active Prodigal Son picture and existing Scene 01. Save a recoverable project snapshot before applying the replacement. Preserve unrelated local work. Locate the actual active project; do not replace it with bundled demo data.

2. Inspect the supplied JSON and CSV together. Read the `LTXDirector` timeline and verify its serialized copies agree: `properties`, `widgets_values_named`, and `widgets_values`, including `timeline_data`, `local_prompts`, `segment_lengths`, and the timing fields. Use the CSV as the image-to-shot mapping. The intended total is 5,040 frames at 24 fps. Keep all generation controls from this package, including **Distilled off** and **Tiled decode on**; do not substitute another workflow or model preset.

3. Append the included PNG files using new, content-identified media records. Reuse a byte-identical existing media item when available. Do not overwrite an existing character asset or its approved iteration just because a person appears in a coverage image. Preserve image bytes, aspect ratio, and file hashes. There are 16 unique starting images: seven retained originals at 1920×800 and nine new angles at 1942×809, both approximately 2.4:1. Accept these actual dimensions; do not resize the new images merely to satisfy the previous importer’s fixed-size check. Retain existing assets and earlier iterations for review. Publish app-facing media through the existing media/import pipeline, not temporary extraction paths.

4. Build one scene-scoped replacement for `PS-S01` using the supplied screenplay, 16 prompts, durations, images, and titles. Update its screenplay section, scene duration, shots, Director plan, and corresponding performance beats together. Replace the obsolete Scene 01 shots; merely saving 16 new segments must not leave the previous Scene 01 shots active alongside them. Preserve all other scene IDs, dialogue, shots, image selections, durations, and approvals. Global sequential shot numbers and displayed cumulative start times may shift; later scenes' own timing must not be shortened or stretched.

5. Preserve character IDs and voice-design records, selections, verified reference metadata, and approvals. The young Temple/hillside listener remains distinct from both brothers. Import the new stills as **NEEDS_REVIEW**, with no new automatic character, voice, or first-frame approvals. Store the revised screenplay as a reviewable version; do not mark it approved automatically. Archive earlier Scene 01 takes and mark affected canonical takes and cinematography plans stale instead of deleting their files.

6. Invalidate the applied Scene 01 Cueboard proposal and any queued review/submission tied to the old source. Retain the draft/history for traceability. `undoPerformanceDraft(picture, "PS-S01")` returns the updated emotion workspace; assign it to `picture.emotionPerformance` through the existing state/persistence flow. Do not relabel a previous draft as current. Cueboard reads the **approved** screenplay, so a fresh AI review must use the new screenplay after that version is reviewed and approved. Do not claim this ZIP ran Cueboard's live AI review.

7. Persist the updated active picture through the existing project save/reconciliation flow. Verify that reloading retains the 16-shot Scene 01, its images and 3:30 duration, while the rest of the film and voice selections remain intact. Do not submit a render, invoke a TTS model, or install/change model files as part of this import.

## Existing code to reuse; current importer limitation

These paths were inspected at commit `77a124b`; inspect the current checkout before making changes:

- `scripts/import-prodigal-scene1.py` creates the scene replacement manifest and immutable media. **Its existing validator is specific to the old package:** 22 shots, 280 seconds, 6,720 frames, nine 1920×800 images in `opening_rebuilt`, and an exact workflow filename/document list. This new ZIP will not pass that importer unchanged. Add a narrowly scoped package profile or equivalent safe import for this package; retain path, file-size, hash, timing, image, and serialization validation. Do not disable checks to force the ZIP through.
- `src/lib/studio/prodigal-scene-replacement.ts` provides `hydrateProdigalSceneReplacements`. It coordinates scene shots, screenplay replacement, performance beats, image-review records, the Director plan, and previous-take invalidation. Its picture ID and approved-screenplay-version guard must match the actual target. If they do not, use an explicit scoped replacement against the active picture; do not bypass the guard or restore an old approved screenplay just to trigger hydration.
- `src/lib/studio/director-scene-authoring.ts` defines `DirectorScenePlan` and `imageBinding` (`mediaUri`, `sha256`, and optional iteration/asset IDs). `saveDirectorPlan` by itself does **not** remove obsolete shots or replace the screenplay, so it is not a complete Scene 01 replacement.
- `src/lib/emotion/integration.ts` contains `undoPerformanceDraft`, `isPerformanceDraftStale`, and `approvedPerformanceSource`. Preserve their distinction between a saved screenplay draft and the approved source used by Cueboard.

The package is a native ComfyUI workflow plus source assets and documents. It is **not** an already imported Premiere316 project or a universal one-click ZIP format. Report the actual importer adaptation and project update performed.

## Acceptance check

Confirm 16 contiguous segments / 5,040 frames / 3:30, all referenced image files resolve, the two removed parables are absent, and the new angle sequence is visible in Scene 01. Compare other scenes and voice references before/after, allowing only global numbering/totals to change. Reload once to check persistence and idempotency. Report any remaining inference or visual-render uncertainty without generating a test clip automatically.

## Existing local references retained, not bundled

The workflow retains two original IC image-reference paths and three voice-file paths. These files are **not included** in this ZIP:

- `whatdreamscost/1a7cf183faa1-PS-CHR-JESUS.png`
- `whatdreamscost/87ed7075b0e7-PS-LOC-HILLSIDE.png`
- `voices/shared/JESUS.flac`
- `prodigal_son/voices/PHARISEE-reference.flac`
- `prodigal_son/voices/SCRIBE-reference.flac`

Keep the existing files and identity bindings. Resolve them in the user’s current ComfyUI input/media setup before rendering; existing thumbnails do not prove the underlying files are present. If a retained reference is missing, report its path and reconnect the corresponding existing approved reference. Do not invent a voice, substitute an unrelated character board, or generate replacement TTS. The 16 supplied scene stills are coverage assets and do not replace these identity/location reference files.
