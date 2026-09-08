# Advanced Departments is not the main workflow

Branch: `premiere316-v3`
Build ID: `p316-20260908170524-18c3fa365c05`

## What was fixed

Advanced Departments no longer opens the old numbered 14-tab product path.
Research Advanced is no longer a manual-first worksheet.

## Default Mode (kept)

```text
01 Intake
02 Assets
03 First / Last
04 Video Clips
05 Export
```

Phase-review checkboxes still default OFF.
M1-PLUS import/export regression still passes.
No ComfyUI. No 8188. No cloud fallback.

## Advanced Departments

Clicking **Advanced Departments** now lands on a dashboard of optional inspection rooms.

Each card shows status, what it controls, last updated, an Open button, and **Required in default mode: No**.

Primary action: **Return to Default Mode**.
Inside a department, nav is grouped as tools:

```text
Research & Story
Planning
Production Review
```

Departments are not numbered 01–14.

## Research Room

Primary CTA: **Run Local Research Room**.
Empty state: **No Research Bible has been generated yet.**
Manual source entry is collapsed under **Advanced: manual source entry**.
Offline model copy points at LM Studio Local API + Rescan; it does not dump the user into a worksheet.

This is a UI/UX correction. It does not claim:

```text
Real Llama research works
Real screenplay automation works
Inventory extraction works
```

## Evidence

```text
docs/release/advanced-departments-not-main-workflow.md
screenshots/advanced-departments-not-main-workflow/
  default-mode.png
  advanced-dashboard.png
  advanced-research-empty.png
  advanced-research-manual-collapsed.png
  test.log
  typecheck.log
  build.log
  electron-pack.log
  packaged-uat.json
```

## Packaged UAT

```text
Default Mode: only five touchpoints visible — pass
Advanced Departments: dashboard appears first — pass
Advanced Research: Run Local Research Room CTA — pass
Manual source entry collapsed — pass
Empty state is not a manual worksheet — pass
Return to Default Mode — pass
100% / 150% no horizontal overflow — pass
No ComfyUI / 8188 / cloud — pass
M1-PLUS import/export regression — pass
```
