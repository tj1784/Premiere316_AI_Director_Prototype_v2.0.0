# Contextual Agency — foundation

Baseline: `1ee4843`. Program: Contextual Agency and User Independence.

## Shared layer

| Piece | Path |
|---|---|
| Intent + slot states | `client/src/contextual-agency/types.ts` |
| Drawer store | `client/src/contextual-agency/action-store.ts` |
| Attach / result protocol | `client/src/contextual-agency/attach-protocol.ts` |
| Missing-work index | `client/src/contextual-agency/missing-work-index.ts` |
| Global drawer | `client/src/components/AssetActionDrawer.tsx` |
| Requirement slot | `client/src/components/RequirementSlot.tsx` |
| Browser UAT harness | `tests/e2e/uat-harness.mjs` |

Workspaces call `openAssetAction(intent)`. Do not add a second drawer. Generic Open Asset Library is not the primary repair path.

## Rules the layer already encodes

- Replacement is vN+1, never overwrite.
- New upload/generate starts unapproved.
- Generate may disable when a provider is offline; upload / create / choose / review stay on.
- Drawer restores focus to `returnFocusId`.
- Qwen remains the default voice provider (IndexTTS is an explicit alternative only).

## Live mutations

The drawer calls createAsset, uploadAssetImage / uploadAssetAudio, generateAsset, pproveAsset, and patchAsset (choose / attach / unlink via dependencies). Filled Character sheets, wardrobe, and voices open this drawer. Restore has no active-version API yet.

## Next

Hold P0 until Reviewer sees a mode mutate project state. Then Characters CHR-001–009 and Storyboard STB-001 / STB-002 / STB-008.
