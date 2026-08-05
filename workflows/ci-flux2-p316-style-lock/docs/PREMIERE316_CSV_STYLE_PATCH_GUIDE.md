# Premiere316 CSV Style-Lock Patch Guide

The included Python utility patches your existing 37-column Premiere316 asset CSV without splitting multiline prompts.

It preserves:
- UTF-8 with BOM output for Excel
- CSV quoting for multiline prompts
- row count
- existing asset IDs
- existing voice sample/dialogue fields
- row order

It updates image-capable categories to the style-only FLUX workflow and adds the style-only reference lock to the prompt field unless already present.

## Run

```powershell
python .\TOOLS\update_premiere316_asset_csv_style_lock.py `
  --input .\premiere316_assets.csv `
  --output .\premiere316_assets_STYLE_LOCKED.csv
```

Or use the wrapper:

```powershell
.\TOOLS\update_premiere316_asset_csv_style_lock.ps1 -InputCsv .\premiere316_assets.csv -OutputCsv .\premiere316_assets_STYLE_LOCKED.csv
```

After patching, import the CSV into Excel and confirm it still shows 97 rows and 37 columns.
