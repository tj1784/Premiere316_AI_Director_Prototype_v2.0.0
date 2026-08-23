# Character Sheet Generation — gpt-image-2 Prompt

How to convert a single reference photo (a headshot, or ideally a real full-body photo) into a
**4-panel character sheet** used as the training/inference reference for the
[LTX-Best-Face-ID](https://huggingface.co/Alissonerdx/LTX-Best-Face-ID) character-sheet checkpoint.

## What it produces

A single image, 4 panels arranged left to right, all on a clean white background:

1. **Face close-up** (head and shoulders, front-facing)
2. **Full body — front view**
3. **Full body — side view** (90° profile)
4. **Full body — back view**

The same person's exact face, hair, and clothing are preserved across all four panels.

> ⚠️ **The reference image resolution must be `1536×1024`.** The LTX character-sheet LoRA was
> trained on sheets at this exact size — ask for `1536x1024` / landscape when generating it, and
> use `ref_resize_mode = native_resolution` on the ComfyUI node at inference time (see below).

## Model

`gpt-image-2` — the easiest way is to just **upload your photo to ChatGPT** and paste the prompt
below (image generation/editing is built in, no API needed). Ask for it at **1536×1024** / landscape.

## The prompt

```text
Convert the person in the photo into a character reference sheet with four panels
arranged left to right: a close-up of the face, then full-body front, side, and back
views, on a white background.
```

If your source image already shows the full body (recommended — see below), you can use the
longer, more explicit version, which gives more consistent results:

```text
Create a character reference sheet on a clean white background, divided into FOUR panels
arranged side by side, using the person in the input image as the exact subject.
Panel 1 (leftmost, narrower panel): a CLOSE-UP of the person's FACE ONLY (head and shoulders,
front-facing, filling most of the panel) — zoom in on the face shown in the input image.
Panel 2: FULL BODY (head to toe) FRONT view, facing directly forward.
Panel 3: FULL BODY (head to toe) SIDE view, facing 90 degrees to the right.
Panel 4: FULL BODY (head to toe) BACK view, facing completely away (back of head and body visible).
Preserve the person's exact facial features, skin tone, hair color, hair style, and EXACT clothing
(same garments, colors, and patterns) as shown in the input image, consistent across all four panels.
Panels 2-4 must show the full body with no cropping. White background. Equal white spacing between
panels. No text, no labels, no borders.
```

## Input image matters a lot

- **If the input is a real full-body photo:** the model can *see* the actual clothing and just
  needs to re-render it from new angles — clothing stays accurate across all four panels. This is
  the recommended input.
- **If the input is only a face/headshot crop:** the model has no information about the person's
  body or clothing below the neck, so it has to **invent** an outfit for panels 2–4. The face
  panel stays accurate; the body panels won't match any real clothing the person owns. Still
  useful for identity, less useful if you need clothing consistency.

## Using the result

- **For inference** (ComfyUI, `LTX Identity Transfer` node): feed the 4-panel sheet directly as
  the reference image, `source_id=2`, and set **`ref_resize_mode = native_resolution`** — the
  sheet is a wide (1536×1024) image trained at its own fixed resolution, independent of the output
  video's resolution. Using the default `match_target` mode squashes the sheet down to the video's
  resolution and destroys facial/clothing detail.
- **For training:** pair the sheet with the ORIGINAL video the reference came from and a caption
  describing the scene/action (`ref_t2v: ...`), same `source_id=2` / `layout=overlap` conditioning
  as the base close-up recipe.

## Notes / gotchas

- `gpt-image-2`'s moderation occasionally rejects an input with `safety_violations=[sexual]` even
  for ordinary photos (more often with athletic/swimwear-adjacent source images) — handle this as
  a normal failure case and skip that sample, don't retry blindly.
- Rate limits are tight (roughly 5 images/min per account at time of writing) — space out batch
  requests (e.g. ~13s between calls) and use a small thread pool rather than firing all requests
  at once.
