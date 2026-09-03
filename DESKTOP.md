# DESKTOP APPLICATION OVERRIDE

Premiere316 V3 is a **standalone Windows desktop application**, not a browser-delivered product.

Preserve the existing React UI, but host it inside a secure Electron desktop shell.

`localhost:8080` may remain available only for development/debugging. Production builds must launch through `Premiere316.exe` and must not open Chrome, Edge, or another external browser.

Architecture (locked):

```text
Electron + React/TypeScript renderer + secure local backend + native FFmpeg/model sidecars
```

```text
React renderer
     ↓ typed allowlisted preload
Electron main
     ↓
local control service on 127.0.0.1  (implementation detail)
     ↓
model engines / FFmpeg / SQLite
```

The local HTTP service is an implementation detail. The user never opens a browser, remembers a port, or starts a dev server.

Production startup:

`Double-click Premiere316 → application opens → projects are immediately available.`

Requirements:

- Windows installer and executable
- native taskbar/application icon
- normal minimize/maximize/close behavior
- native open/save/folder dialogs
- drag-and-drop local files
- access to `D:\AI\Models` through privileged backend/preload APIs, never direct unrestricted renderer filesystem access
- secure credential storage (`safeStorage`)
- Electron `contextIsolation: true`
- `nodeIntegration: false`
- sandbox renderer
- typed allowlisted preload bridge
- backend/model processes automatically start and stop with Premiere316
- no manual terminal required
- no manual localhost navigation required
- no dependency on an external browser
- development browser preview may remain available separately (`npm run dev`)

Do not switch this build to Tauri.

Final user experience (product, not Chrome):

```text
Premiere316.exe
      ↓
Premiere316 desktop window
      ↓
Home = Pictures
      ↓
+ New Picture
      ↓
Intake → Screenplay → Assets → Performances → Shots → Generate → Edit → Export
```
