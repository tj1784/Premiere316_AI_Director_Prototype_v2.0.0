# Premiere316 V3.02

Standalone picture factory. Screenplay → inventory → T2I / T2Voice prompts → stills → 10–15s I2V performance clips → stitch → Music3 score → export.

No ComfyUI. Local weights live at `D:\AI\Models`. Engines from MiniMax, Krea, Black Forest Labs, Lightricks, Dramatron, IndexTTS, Fish Speech, Qwen3-TTS, and the rest of the bay are selectable components.

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
