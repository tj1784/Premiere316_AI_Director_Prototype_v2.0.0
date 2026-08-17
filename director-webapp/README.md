# LTX 2.5 Director Webapp

A focused local timeline editor for `LTX2.5_DIRECTOR.json`. It connects to the Premiere316 BlokeyUI ComfyUI engine at `http://127.0.0.1:8188` and serves the UI at `http://127.0.0.1:8791`.

## Start

Double-click `START_LTX25_DIRECTOR.cmd` in the Premiere316 project root, or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\director-webapp\start-director.ps1
```

The launcher reuses an already-running Director server and opens the browser. It does not start, stop, or restart ComfyUI.

## Behavior

- The main view contains only the media toolbar, Main/Audio/IC-LoRA timeline, transport, selected segment prompt, and global prompt.
- The Premiere project bar loads the canonical project storyboard directly. The Project media drawer exposes scenes, each scene's exact pinned references, globally approved media, the wider project library (including voice assets), registered videos, and generation status.
- Loading a storyboard scene preserves its authored segment IDs, prompts, timing, frame rate, delivery size, and active generated guide versions. Missing image guides stay visibly unresolved and block full-scene generation instead of silently becoming text-only prompts.
- **Save to Premiere** publishes prompt edits back to the bound storyboard scene while keeping its editorial duration locked. **Generate scene** queues the complete scene on ComfyUI 8188 only when every required visual guide is available.
- Finished scene videos are verified for the requested size, frame rate, frame count, duration, and final output node before being versioned into that Premiere project's `media/clips` library. LTX's internal `8n+1` generation length is conformed back to the exact editorial frame count.
- Project output jobs use their own durable Director ledger and do not overwrite the main Premiere generation queue history.
- Connection, delivery size, FPS, resize behavior, track toggles, negative prompt, execution details, reset, and export are in Settings.
- Browser interactions update lightweight DOM elements; drag operations commit only when the pointer is released.
- The supplied file is a ComfyUI UI workflow containing an embedded UUID subgraph. The server flattens it and validates all 30 native prompt nodes against live `/object_info` before queueing.
- Local edits are stored under `director-webapp/state/`. The original file in Downloads is never modified.
- Queue selected renders one selected image/video segment. Queue all segments creates one rebased prompt per main image/video segment.

## Premiere project readiness

The app lists every Premiere316 project. Projects without a production storyboard still expose their available project media. For storyboard projects, the scene picker labels each clip as **ready** or **needs guide**. A scene marked **needs guide** remains editable and browsable, but the full-scene generation button stays disabled until its authored visual frames have valid active versions on disk.

## Important source-workflow note

The source workflow displays an IC-LoRA/motion reference track, but that track is not connected to the executable guide/model sockets in the supplied graph. The app preserves this behavior instead of silently changing generation. Repairing that graph is a separate, explicit workflow change.
