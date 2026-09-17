# Premiere316 V3.02

Standalone picture factory. Screenplay → inventory → T2I / T2Voice prompts → stills → 10–15s I2V performance clips → stitch → Music3 score → export.

Native still adapters use local weights at `D:\AI\Models`. LTX Director is the default video option. Create and edit scenes in Premiere, reuse existing asset images, then review and approve workflows for direct API generation on 8190. Premiere shows generation stages and completed videos without opening ComfyUI. Audio setup and generation are deferred.

The Prodigal Son includes 22 Director workflows, 131 starting images, and 3 reused memory excerpts. Generate also offers MiniMax-Music3, YuE2, Stable Audio 3 Medium, ACE-Step 1.5, Qwen3 VoiceDesign/Base, VoxCPM2 and IndexTTS-2.5 with separate song, instrumental/SFX and speech setup guidance. Model weights are not downloaded automatically.

Open **The Last Reel** sample to walk the pipeline. Export writes Fountain, EDL, shot list, prompt pack, cue sheet, and project JSON.

## Desktop

**Hard lock:** Premiere316 V3 ships as `Premiere316.exe`, not a browser app. See `DESKTOP.md`.

Chrome / `localhost:8080` is development scaffolding only. Production never opens Chrome, Edge, or another external browser.

```text
npm run electron:dev   # desktop window (starts the UI server if needed)
npm run electron:pack  # Premiere316.exe + Premiere316-Setup.exe
```

- App: `dist-desktop/win-unpacked/Premiere316.exe`
- Installer: `dist-desktop/Premiere316-Setup.exe`

Double-click Premiere316 → the desktop window opens → pictures are immediately available.

The renderer never gets Node or unrestricted `D:\AI\Models` access. Catalog, stills, engine spawn, credentials, and native dialogs go:

`React → typed preload request → Electron main → local backend → D:\AI\Models`
