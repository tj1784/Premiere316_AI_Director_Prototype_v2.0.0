# Generate three-gate cohesion

Status: **GREEN** (workflow). Native H3/LTX and TTS/Music3 remain blocked.

Build: `p316-20260907234856-679651a385b1`  
Tag: `generate-three-gate-cohesion-p316-20260907234856-679651a385b1`

## Gates

1. **Assets** — prepared still generation (Wave 4) + voice fail-closed assets
2. **First / Last Frames** — versioned prompts, fail-closed native generate, waive-for-import, stale reasons
3. **Video Clips** — native queue locked until a pair is approved or waived; **Import video always allowed** and labeled imported

Downstream native generate does not auto-start. Imported M1-PLUS path remains valid via waive or import-without-native-generate.

No ComfyUI, no :8188, no cloud, no stills-as-video.
