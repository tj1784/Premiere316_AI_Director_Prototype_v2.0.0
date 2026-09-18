# Cueboard and voice references

Cueboard is integrated in the existing Performance department. The original catalogue, schema, compiler and tests are reused unchanged; `src/lib/emotion/UPSTREAM.json` records their hashes. The supplied ZIP and standalone application are untouched.

## Flow

1. Approve the screenplay and select/load the configured local writer through existing screenplay controls.
2. Open Performance > Cueboard, select scenes or all scenes, and request AI review. Full approved screenplay context is supplied. Oversized context fails without truncation; no model is silently loaded or substituted.
3. Review acting/delivery prompts. Edit structured settings, validate/save a new version, and explicitly apply selected proposals. Previous versions remain available to reapply or unapply; source changes mark drafts stale.
4. Approve hash-verified character images and voice recordings. Individual ensemble members have independent selections. Audition transcripts remain separate from screenplay dialogue.
5. Under an applied draft, import an API-format direct H3 Ref2VA workflow, select lines, assign speaker references explicitly, review live capabilities, then approve one clip.
6. Check clip status to recover after reload and view/download results. Completed clips are registered in the owning project media folder. An active server monitors jobs for completion. Generated clips are not automatically approved.

## Capability boundaries

- The installed H3 instance at 127.0.0.1:8191 is supported only for direct `MiniMaxH3ReferenceToVideo` API graphs with verified Ref2VA model ancestry, actual reference loaders and connected audiovisual saved output. Seeds and sampling settings remain those imported.
- Media bytes are hashed, uploaded, fetched back and rechecked before submission. Prompt tags are one-based; actual ComfyUI reference sockets are zero-based.
- At most three speakers, 15 seconds total reference audio and 362 output frames. No automatic trimming. Existing reference connections require explicit review/clearing before new bindings.
- FL2VA, hybrid/ambiguous models, visual/Director graphs and LTX supplied-audio conditioning are unsupported in this voice-identity-only path. No separate dialogue TTS job, route or fallback is connected. Unrelated voice-design tools remain available.
- Silent reactions require existing character-assigned reaction beats. Scenes without parsed dialogue or assigned reactions report the missing assignment. Batch failures retain preceding successful proposals.
- Execution/archive require the local project runtime. After server shutdown, Check clip status recovers through the existing job journal; ComfyUI history/output must remain available.

## Persistence

Voice records merge by revision, explicit tombstones survive stale tabs, and equal-revision conflicts require review. Selections bind to exact iteration revisions/hashes without fallback. Member identity, transcripts, audition purpose, warnings, provenance and review history survive normalization and reuse. Canonical media identifiers and signed proof objects survive localization; playback uses separate preview URIs. Legacy unverifiable selections require reapproval; lost identities/approvals are never fabricated.

Approved-reference export is versioned. VoiceDesign import/export validates connected editable inputs, engine/designer/preview/saver paths, duplicate identifiers and contradictory widget values.

## Verification — 2026-09-17

- 97 focused tests: upstream compiler/schema, dialogue/request mapping, voice library/member identity/reconciliation, canonical image proof preservation, project storage, shared execution and H3 adapter.
- Typecheck and production build passed.
- Dev and built-output browser checks passed at 1280x800 and 390x844: no console/page errors, overflow or baseline divergence. Screenshots visually inspected. Existing missing custom `public/og.jpg` branding note remains.
- Interactive Cueboard expansion, scene selection and unloaded-writer error verified.
- Installed H3 node schemas/sockets inspected. Adapter/queue tests use fixtures. **No real AI proposal or video inference completed:** configured writer was unloaded. No full-film or separate TTS generation launched.

## Safe checkout

Preserve unrelated local cover edits and project media by fetching into a separate code checkout:

```powershell
git -C D:\Projects\Premiere316_v3 fetch origin
git -C D:\Projects\Premiere316_v3 worktree add --detach D:\Projects\Premiere316_voice_reference_review origin/codex/voice-reference-emotion
```

The destination must not already exist. This does not copy production project media. Do not run two app instances against the same project data.
