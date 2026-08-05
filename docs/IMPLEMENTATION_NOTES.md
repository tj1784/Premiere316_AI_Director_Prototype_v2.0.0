# Premiere316 implementation notes

## Selected-segment compilation

The application stores timing in frames. A selected contiguous group is compiled as:

```text
startFrame = first selected segment start
endFrame   = last selected segment end
requested  = endFrame - startFrame
generated  = ceil((requested - 1) / 8) * 8 + 1
```

Prompts are clipped to that window, shifted to local frame zero, and joined with ` | `. The generated output is trimmed to `requested` frames before it is stored.

Noncontiguous segment selections are grouped into separate queue jobs. This avoids accidentally generating the unselected gaps between them.

## Guide serialization

Guide images are stored separately from Prompt Relay segments in project data, then compiled into Director-compatible timeline entries:

- `first`: local frame zero
- `middle`: its exact local frame
- `last`: the final requested frame with `isEndFrame: true`

When rendering a range that starts after an earlier guide, the latest prior guide is brought to local frame zero as a continuity fallback.

## Range-version assembly

A partial render never destroys the current accepted clip. During assembly:

1. The active full/assembled version becomes the baseline.
2. Active range versions created later than that baseline become overrides.
3. All range boundaries create exact intervals.
4. The newest range covering each interval wins.
5. Uncovered intervals read from the baseline.
6. FFmpeg trims and concatenates those exact intervals into a new accepted version.

## Music pipeline

The master pipeline runs in this order:

```text
resolve active clips
→ assemble range overrides
→ normalize and stitch sequence
→ obtain exact master duration
→ select or generate project score
→ fade and duck music under existing audio
→ export H.264/AAC master
```

## Replacing the prototype guide and score generators

The extension points are in `server/ffmpeg.js` and called from `server/queue.js`:

```text
generatePrototypeGuide(...)
generatePrototypeScore(...)
```

A production adapter can instead:

1. Load a ComfyUI workflow template.
2. Convert it with `graphToApi`.
3. Patch prompt, seed, dimensions, duration, and reference inputs.
4. Call `runPrompt`.
5. Download the result into the project media folder.
6. Register the returned asset as a guide or score version.
