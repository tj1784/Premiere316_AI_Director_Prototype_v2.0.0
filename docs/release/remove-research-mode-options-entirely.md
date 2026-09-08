# Remove research mode options entirely

Branch: `premiere316-v3`
Build ID: `p316-20260908171943-b3e53d9ff9d3`

## What was fixed

The Research screen no longer shows a MODE selector, Web-assisted option, or Local option.

Premiere316 owns the internal research method. The user sees:

```text
Build Research Draft
Regenerate
Delta Research
Add Source Material
Manual Notes
```

## Removed

```text
MODE
Web-assisted (unavailable)
Local / user-provided
Research mode dropdown
Run Local Research Room
Local only
```

## Right panel

```text
RESEARCH STATUS
MODEL STATUS
ACTIONS (Rescan, Regenerate, Delta Research)
```

Unavailable copy:

```text
Configured AI model unavailable.
Start the configured model server, then Rescan.
```

## Default Mode

Unchanged:

```text
01 Intake
02 Assets
03 First / Last
04 Video Clips
05 Export
```

Research is not a Default Mode gate.

## Evidence

```text
docs/release/remove-research-mode-options-entirely.md
screenshots/remove-research-mode-options-entirely/
  research-before.png
  research-after.png
  string-scan-proof.json
  packaged-uat.json
  test.log
  typecheck.log
  build.log
  electron-pack.log
  no-cloud-no-web-no-comfy-no-8188-proof.json
```
