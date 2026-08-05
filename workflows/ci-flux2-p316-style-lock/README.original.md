# CI FLUX2 Premiere316 Style-Lock Asset Workflow Package

This package updates the original cinematic character-sheet workflow so the same artistic design can be reused across the full Premiere316 asset list without copying the Jesus character, costume, wounds, sword, or scene content into unrelated assets.

## What changed

- Added six `CI_STYLE_REF_*.png` art-direction references.
- The references are cropped/blurred/abstracted style plates, not identity/content references.
- Added three ComfyUI workflow presets:
  - `CI_FLUX2_P316_STYLE_ONLY_ASSET_4X3_MAX.json`
  - `CI_FLUX2_P316_STYLE_ONLY_ASSET_16X9_MAX.json`
  - `CI_FLUX2_P316_STYLE_ONLY_ASSET_2X3_VERTICAL_MAX.json`
- Added matching API JSON files for CineForge / ComfyAPI Runner.
- Added a CSV patch utility for your 97-row / 37-column Premiere316 asset CSV.
- Added category prompt envelopes for Characters, Wardrobe, Locations, Props, Crowds, Atmosphere/VFX, Guide Frames, Voices, Sound Design, Music, and Graphics.

## Install

Copy everything inside:

```text
DROP_CONTENTS_INTO_COMFYUI/
```

into your ComfyUI root.

That places style references in:

```text
ComfyUI/input/CI_STYLE_REF_*.png
```

and workflows in:

```text
ComfyUI/user/default/workflows/
```

You can also drag this PNG into ComfyUI:

```text
CI_FLUX2_P316_STYLE_ONLY_ASSET_WORKFLOW.png
```

## Use

1. Open the workflow preset that matches the asset:
   - 4X3 for general production assets.
   - 16X9 for guide frames, locations, crowd shots, and atmosphere/VFX.
   - 2X3 vertical for character/wardrobe/hero prop studies.
2. Paste the row's `Complete current generation prompt` into the orange prompt node.
3. Keep the row prompt as the content source-of-truth.
4. Do not load the original Jesus images for batch assets unless the row is specifically Jesus.
5. Queue Prompt.

## Reference behavior

Default active:

- `CI_STYLE_REF_01_GLOBAL_GOLDEN_LIGHT_PALETTE.png`
- `CI_STYLE_REF_02_SMOKE_CAVE_EMBER_PALETTE.png`
- `CI_STYLE_REF_03_FILMIC_SKIN_LINEN_TONALITY.png`

Bypassed by default:

- `CI_STYLE_REF_04_IVORY_LINEN_BLOOD_MATERIAL_DETAIL_OPTIONAL.png`
- `CI_STYLE_REF_05_GOLD_VFX_GLOW_OPTIONAL.png`
- `CI_STYLE_REF_06_CHARACTER_SHEET_ART_DIRECTION_OPTIONAL.png`

Enable optional refs only when the row actually benefits from that material/VFX/layout influence.

## CSV support

The CSV utility preserves multiline prompts and UTF-8 BOM output:

```powershell
python .\TOOLS\update_premiere316_asset_csv_style_lock.py `
  --input .\premiere316_assets.csv `
  --output .\premiere316_assets_STYLE_LOCKED.csv
```

It is designed for the validated Premiere316 table structure you described: 97 rows, unique asset IDs, 37 columns, quoted multiline prompts, and Excel-safe UTF-8 with BOM.

## Important

The old character-sheet workflow is still included as:

```text
CI_FLUX2_Cinematic_Character_Sheet_JESUS_ONLY_MAX.json
```

Use that only for the Jesus character sheet. Use the new style-only workflows for the other 97 assets. The original `CI_REF_*.png` files are included only so the Jesus-only workflow remains runnable; do not use them for batch rows unless the row is specifically the Jesus asset.
