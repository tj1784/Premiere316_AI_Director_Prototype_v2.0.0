# LTX Jesus identity repair checkpoint

This is a local checkpoint of the best verified state after final cleanup.

- Canonical ComfyUI: `http://127.0.0.1:8188`
- Best strict result: `22/49` frames at or above the calibrated NIF90 identity boundary (`44.897959%`)
- All 49 frames had a scorable detected face.
- Best tuning: LTX Likeness Anchor strength `0.35`, similarity threshold `0.50`, pass 1 reference enabled, pass 2 reference bypassed, `768x320`, `49` frames, `24 fps`.
- Strict success criterion was `>=45/49` frames; it was not reached with the locally available matching identity models.

## Preserved artifacts

| Artifact | SHA-256 |
|---|---|
| `BlokeyUI/ComfyUI/user/default/workflows/GARDEN_identity_repaired.json` | `CC7B309591A871657C8682A311C1A82736B1CC603BB510A27AA78DC087E3B3AC` |
| `BlokeyUI/ComfyUI/user/default/workflows/GARDEN_identity_test_garden-face-best-r10-final.json` | `38F698132FE30CBEF0589DB91A8AC0E200D517D508734274B651237D4A0F3D6C` |
| `BlokeyUI/ComfyUI/output/identity_tests/garden-face-likeness035-r10_00001-audio.mp4` | `8B839D998674F7F7CA586ABF36F0389D8B369B7E6919C943A36D202974735E80` |
| `diagnostics/ltx-identity-tuning/garden-face-likeness035-r10.score.json` | `63DB01F30906E4B884B284CAE4C414DF30C6AA16DBDCB4DD22B20BEED3E7D2CB` |
| `scripts/ltx-identity-tune.mjs` | `07D249F09377BC1AB0AF78544473B99D5B9D7D10E6DD6706A3D033F839B3BEBF` |
| `scripts/score-ltx-face-identity.py` | `6B11576C4DE94ECFBC524434FE5213020833BF62E1F9B856981173627107F27B` |
| `BlokeyUI/ComfyUI/custom_nodes/10S_Nodes/ltx_reference_enable.py` | `878414597ADF6A095442A5279F1666AFE7FC4F877A328B55913472910A11229C` |

## Proven root fixes

- The canonical portrait was not connected to the executed conditioning path; the wide scene keyframe was the only effective image guide.
- The final crop used first-pass conditioning against the second-pass latent, which produced the wrong output length. The repaired graph uses node 58 conditioning and produces exactly 49 frames.
- The AV reference hook was repaired in `ltx_reference_enable.py`.
- The supplied new character-sheet images were rejected as canonical identity inputs because none matched the canonical face-verification boundary.

## Final live verification

- Premiere316 health reports `comfyUrl=http://127.0.0.1:8188` and connected.
- ComfyUI 8188 restarted cleanly with `--disable-dynamic-vram --fast fp16_accumulation`.
- The queue returned to `0 running / 0 pending`.
- `LTXReferenceConditioning`, `LTXLikenessAnchor`, and `LTXLikenessCrop` are registered.
- The rejected ReActor experiment is not registered after restart. Its files were moved recoverably to `diagnostics/rejected-reactor-experiment/` rather than deleted.
