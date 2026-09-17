import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const DIRECTOR_ORIGIN = "http://127.0.0.1:8190";
const TOOLBAR_HEIGHT = 48;
const LOAD_TIMEOUT_MS = 45_000;

function cancelledError() {
  const error = new Error("The Director workspace was closed before the selected scene was ready.");
  error.name = "DirectorWorkspaceCancelled";
  return error;
}

function directorUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === DIRECTOR_ORIGIN && !url.username && !url.password;
  } catch { return false; }
}

function workflowSnapshot(workflow) {
  const copy = JSON.parse(JSON.stringify(workflow));
  const directors = copy?.nodes?.filter((node) => node.type === "LTXDirector");
  if (directors?.length !== 1) throw new Error("Choose a scene workflow containing exactly one LTX Director node.");
  let timeline;
  try { timeline = JSON.parse(directors[0].properties?.timeline_data); } catch { /* Report an actionable error below. */ }
  if (!Array.isArray(timeline?.segments)) throw new Error("The selected Director workflow has no readable timeline.");
  return { copy, directorId: directors[0].id, timeline };
}

function loadWorkflowScript({ copy, directorId, timeline }, generationKey, generation) {
  return `(async () => {
    const generationKey = ${JSON.stringify(generationKey)};
    const generation = ${generation};
    window[generationKey] = Math.max(window[generationKey] ?? 0, generation);
    const assertCurrent = () => {
      if (window[generationKey] !== generation) {
        const error = new Error('The selected Director scene changed or was closed.');
        error.name = 'DirectorWorkspaceCancelled';
        throw error;
      }
    };
    assertCurrent();
    const deadline = Date.now() + 20000;
    let directorApp;
    while (Date.now() < deadline) {
      assertCurrent();
      directorApp = window.comfyAPI?.app?.app ?? window.app ?? window.comfyApp;
      const splash = document.getElementById('splash-loader');
      const loading = splash && getComputedStyle(splash).display !== 'none' && getComputedStyle(splash).visibility !== 'hidden';
      if (!loading && directorApp?.graph && typeof directorApp.loadGraphData === 'function') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!directorApp?.graph || Date.now() >= deadline) throw new Error('LTX Director editor did not become ready.');
    const workflow = ${JSON.stringify(copy)};
    const expectedTimeline = ${JSON.stringify(timeline)};
    assertCurrent();
    await directorApp.loadGraphData(workflow);
    assertCurrent();
    const directors = directorApp.graph._nodes.filter(node => node.type === 'LTXDirector');
    const loadedDirector = directors.find(node => String(node.id) === String(${JSON.stringify(directorId)}));
    if (directors.length !== 1 || !loadedDirector) throw new Error('The selected scene Director node did not load.');
    let loadedTimeline;
    try { loadedTimeline = JSON.parse(loadedDirector.properties.timeline_data); } catch {}
    if (JSON.stringify(loadedTimeline) !== JSON.stringify(expectedTimeline)) throw new Error('LTX Director loaded a different scene timeline.');
    const expected = expectedTimeline.segments.filter(segment => segment.imageFile || segment.imageB64).map(segment => segment.id);
    const imageDeadline = Date.now() + 20000;
    let imagesReady = expected.length === 0;
    while (!imagesReady && Date.now() < imageDeadline) {
      assertCurrent();
      const segments = loadedDirector._timelineEditor?.timeline?.segments;
      imagesReady = Array.isArray(segments) && expected.every(id => {
        const segment = segments.find(item => item.id === id);
        return segment?.imgObj?.complete && segment.imgObj.naturalWidth > 0;
      });
      if (!imagesReady) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!imagesReady) throw new Error('Starting images could not be displayed in LTX Director. No render was submitted.');
    assertCurrent();
    const canvas = directorApp.canvas;
    if (canvas?.ds && loadedDirector.size && canvas.canvas) {
      canvas.ds.scale = Math.max(0.1, Math.min(0.9, (canvas.canvas.clientWidth - 100) / loadedDirector.size[0], (canvas.canvas.clientHeight - 120) / loadedDirector.size[1]));
      canvas.centerOnNode?.(loadedDirector);
      canvas.setDirty?.(true, true);
    }
    return true;
  })()`;
}

/** A reusable in-window editor; the main Premiere renderer and its state remain mounted. */
export function createDirectorWorkspace({ WebContentsView, parent, toolbarPath, toolbarPreloadPath, ipcMain }) {
  const token = randomUUID();
  const closeChannel = `p316:director-workspace:${token}:close`;
  const stateChannel = `p316:director-workspace:${token}:state`;
  const generationKey = `__premiere316DirectorLoad_${token}`;
  const toolbarUrl = pathToFileURL(toolbarPath).href;
  let editor = null;
  let toolbar = null;
  let toolbarLoaded = false;
  let editorLoaded = false;
  let attached = false;
  let ready = false;
  let disposed = false;
  let request = 0;
  let wantsVisible = false;
  let pending = Promise.resolve();
  let cancelLoading = null;
  let state = { sceneId: "", pictureId: "", title: "LTX Director", status: "" };
  const cleanups = [];

  const listen = (emitter, event, handler) => {
    emitter.on(event, handler);
    cleanups.push(() => emitter.removeListener(event, handler));
  };
  const alive = () => !disposed && !parent.isDestroyed();
  const updateToolbar = () => {
    if (toolbarLoaded && toolbar && !toolbar.webContents.isDestroyed()) toolbar.webContents.send(stateChannel, state);
  };
  const resize = () => {
    if (!alive() || !editor || !toolbar) return;
    const [width, height] = parent.getContentSize();
    const top = Math.min(TOOLBAR_HEIGHT, Math.max(0, height));
    toolbar.setBounds({ x: 0, y: 0, width: Math.max(0, width), height: top });
    editor.setBounds({ x: 0, y: top, width: Math.max(0, width), height: Math.max(0, height - top) });
  };
  const attach = () => {
    if (!alive() || !editor || !toolbar) return false;
    if (!attached) {
      parent.contentView.addChildView(editor);
      parent.contentView.addChildView(toolbar);
      attached = true;
    }
    resize();
    return true;
  };

  const hide = () => {
    wantsVisible = false;
    if (!attached) return;
    if (!parent.isDestroyed()) {
      parent.contentView.removeChildView(editor);
      parent.contentView.removeChildView(toolbar);
    }
    attached = false;
    if (alive()) parent.webContents?.focus();
  };

  const invalidatePageLoad = () => {
    if (!editor || editor.webContents.isDestroyed()) return;
    // A cancelled load must never resume its readiness polling against a later selection.
    void editor.webContents.executeJavaScript(`window[${JSON.stringify(generationKey)}] = Math.max(window[${JSON.stringify(generationKey)}] ?? 0, ${request});`).catch(() => {});
  };
  const close = () => {
    request += 1;
    if (cancelLoading) {
      ready = false;
      editorLoaded = false;
      invalidatePageLoad();
      cancelLoading(cancelledError());
    }
    hide();
  };

  const guard = (view, isToolbar) => {
    const wc = view.webContents;
    const allowed = isToolbar ? (value) => value === toolbarUrl : directorUrl;
    const navigation = (event, value) => { if (!allowed(value)) event.preventDefault(); };
    listen(wc, "will-navigate", navigation);
    listen(wc, "will-redirect", navigation);
    listen(wc, "will-frame-navigate", (event, details) => {
      // Electron versions expose navigation details either in the second argument or on the event.
      if (!allowed(details?.url ?? event.url)) event.preventDefault();
    });
    listen(wc, "will-attach-webview", (event) => event.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    const isolated = wc.session;
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest({ urls: ["file://*/*"] }, (details, callback) => {
      callback({ cancel: !isToolbar || details.url !== toolbarUrl });
    });
    cleanups.push(() => {
      isolated.setPermissionRequestHandler(null);
      isolated.setPermissionCheckHandler(null);
      isolated.webRequest.onBeforeRequest(null);
    });
    listen(wc, "render-process-gone", () => {
      ready = false;
      editorLoaded = false;
      if (isToolbar) toolbarLoaded = false;
      cancelLoading?.(new Error("LTX Director stopped responding. Return to Premiere and open the scene again."));
      close();
    });
  };

  const ensureViews = async () => {
    if (!alive()) return false;
    if (!editor) {
      const secure = { contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, sandbox: true, webSecurity: true, webviewTag: false };
      editor = new WebContentsView({ webPreferences: { ...secure, partition: `premiere316-director-${token}` } });
      toolbar = new WebContentsView({ webPreferences: {
        ...secure, partition: `premiere316-director-toolbar-${token}`, preload: toolbarPreloadPath,
        additionalArguments: [`--premiere316-director-workspace=${token}`],
      } });
      guard(editor, false);
      guard(toolbar, true);
    }
    if (!toolbarLoaded) {
      await toolbar.webContents.loadFile(toolbarPath);
      if (!alive()) return false;
      toolbarLoaded = true;
      updateToolbar();
    }
    return true;
  };

  const dispose = () => {
    if (disposed) return;
    hide();
    disposed = true;
    request += 1;
    cancelLoading?.(new Error("LTX Director workspace was closed before it was ready."));
    cancelLoading = null;
    for (const cleanup of cleanups.splice(0).reverse()) { try { cleanup(); } catch { /* Session may already have closed. */ } }
    ipcMain.removeListener(closeChannel, onToolbarClose);
    for (const view of [toolbar, editor]) if (view && !view.webContents.isDestroyed()) view.webContents.close();
    editor = null;
    toolbar = null;
  };
  const onToolbarClose = (event) => {
    if (toolbar && event.sender === toolbar.webContents && event.senderFrame === toolbar.webContents.mainFrame) close();
  };
  ipcMain.on(closeChannel, onToolbarClose);
  listen(parent, "resize", resize);
  listen(parent, "closed", dispose);

  return {
    async open(workflow, { sceneId = "", pictureId = "" } = {}) {
      if (!alive()) return false;
      // Snapshot before queueing: later scene selection or caller mutation cannot alter these bytes.
      const snapshot = workflowSnapshot(workflow);
      const selection = { sceneId: String(sceneId), pictureId: String(pictureId) };
      const currentRequest = ++request;
      wantsVisible = true;
      const run = async () => {
        if (!alive() || currentRequest !== request) return false;
        let timer;
        let cancelled = false;
        const unavailable = new Promise((_resolve, reject) => {
          cancelLoading = reject;
          timer = setTimeout(() => reject(new Error("LTX Director did not load the selected scene in time. No render was submitted.")), LOAD_TIMEOUT_MS);
        });
        try {
          return await Promise.race([unavailable, (async () => {
            if (!(await ensureViews()) || cancelled || currentRequest !== request) return false;
            ready = false;
            state = { ...selection, title: selection.sceneId ? `LTX Director · ${selection.sceneId}` : "LTX Director", status: "Opening scene…" };
            updateToolbar();
            if (wantsVisible) attach();
            if (!editorLoaded) {
              await editor.webContents.loadURL(DIRECTOR_ORIGIN);
              if (!alive() || cancelled || currentRequest !== request) return false;
              editorLoaded = true;
            }
            const loaded = await editor.webContents.executeJavaScript(loadWorkflowScript(snapshot, generationKey, currentRequest));
            if (!alive() || cancelled || currentRequest !== request) return false;
            if (loaded !== true) throw new Error("LTX Director could not verify the selected scene.");
            ready = true;
            state = { ...state, status: "" };
            updateToolbar();
            if (wantsVisible && attach()) editor.webContents.focus();
            return true;
          })()]);
        } catch (error) {
          cancelled = true;
          ready = false;
          editorLoaded = false;
          if (currentRequest === request) {
            request += 1;
            invalidatePageLoad();
            hide();
          }
          if (error?.name === "DirectorWorkspaceCancelled") return false;
          throw error;
        } finally {
          clearTimeout(timer);
          cancelLoading = null;
        }
      };
      const result = pending.then(run);
      pending = result.then(() => undefined, () => undefined);
      return result;
    },
    async show() {
      if (!alive()) return false;
      wantsVisible = true;
      await pending;
      if (!ready || !alive() || !wantsVisible) return false;
      const shown = attach();
      if (shown) editor.webContents.focus();
      return shown;
    },
    close,
    dispose,
  };
}
