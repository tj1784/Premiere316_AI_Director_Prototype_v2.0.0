# ADR 0001 — UI/UX release scope for Sequence, Folder Drop, and Comfy Picker

**Status:** Accepted for the current workstation release  
**Date:** 2026-08-22  
**Related:** SCOPE-001, SCOPE-002, SCOPE-003, SCOPE-004, SCOPE-005, SCOPE-006, TAKE-007, TAKE-009

## Context

The `17234f7` QA audit mixed current product defects with a generic cross-device / take-CRUD / asset-gallery plan. Shipping against the generic plan would either invent unsupported platforms or treat missing future features as current bugs.

## Decisions

### SCOPE-001 — Support matrix

Current release support is:

- Windows 11
- Chromium and Microsoft Edge current stable
- Local Premiere316 server + local or managed ComfyUI

Tablet, mobile, Safari, iOS, and Android are later expansion epics, not current release defects.

### SCOPE-002 — Theme

The product remains dark-only for this release. Light mode is a roadmap feature. Forced-colors / Windows High Contrast remains an accessibility requirement (A11Y-013).

### SCOPE-003 — Comfy control is a Workflow Picker

The current Comfy surface selects and loads a workflow graph into the embedded canvas. It is not an asset thumbnail gallery. A gallery, if desired, is a separate approved epic with its own data contract.

### SCOPE-004 / TAKE-007 — Take model

Takes in this release are generated or imported media records associated with storyboard/sequence context. They are not a standalone CRUD entity.

Required now:

- Active / Latest-per-segment / All filters (default Active)
- Replace selected timeline clip with selected take
- Undo of that replacement

Not current bugs:

- Formal Create / Rename / Duplicate / Delete / Reorder take CRUD
- Soft-delete policies for those operations (TAKE-009) until CRUD is approved

### SCOPE-005 — External drag visuals

Acceptance is limited to in-app drop-target feedback, destination preview, valid/invalid cursor where the browser allows it, and post-drop reporting. Custom drag ghosts for Explorer/Finder payloads are not owned by the web app.

### SCOPE-006 — BlokeyUI boundary

BlokeyUI implementation and private UI are out of audit scope. Premiere316 must not depend on untracked `BlokeyUI/ComfyUI/user/default/workflows` files for a reproducible picker. Supported graphs live in the tracked `workflows/` package plus `workflows/manifest.json`.

## Consequences

QA labels only approved operations as defects. Release tests cover the workflow picker, not a gallery. Clean clones must produce the packaged inventory or an explicit missing-library state.
