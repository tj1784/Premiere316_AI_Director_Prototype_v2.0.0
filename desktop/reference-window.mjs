const REFERENCE_ORIGINS = new Set(["https://docs.comfy.org", "https://huggingface.co", "https://github.com"]);
const DIRECTOR_ORIGIN = "http://127.0.0.1:8190";

export function referenceWindowTarget(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.origin === DIRECTOR_ORIGIN) return { url: url.href, origin: url.origin, kind: "director" };
    if (REFERENCE_ORIGINS.has(url.origin)) return { url: url.href, origin: url.origin, kind: "reference" };
  } catch { /* Invalid or non-web URL. */ }
  return null;
}

export function referenceWindowOptions(parent, target) {
  return {
    parent,
    title: target.kind === "director" ? "LTX Director · Premiere316" : "Model reference · Premiere316",
    width: 1200,
    height: 850,
    autoHideMenuBar: true,
    webPreferences: {
      partition: `premiere316-reference-${encodeURIComponent(target.origin)}`,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  };
}

/** Dedicated unprivileged window: no studio preload, shared cookies, or native bridge. */
function createReferenceWindow({ BrowserWindow, parent, url, onError = () => {} }) {
  const target = referenceWindowTarget(url);
  if (!target) return false;
  const win = new BrowserWindow(referenceWindowOptions(parent, target));
  const allowNavigation = (value) => {
    const next = referenceWindowTarget(value);
    return next && (target.kind === "director" ? next.origin === target.origin : next.kind === "reference");
  };
  const guardNavigation = (event, value) => { if (!allowNavigation(value)) event.preventDefault(); };
  win.webContents.on("will-navigate", guardNavigation);
  win.webContents.on("will-redirect", guardNavigation);
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (allowNavigation(nextUrl)) void win.loadURL(nextUrl).catch(onError);
    return { action: "deny" };
  });
  const isolatedSession = win.webContents.session;
  isolatedSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.webRequest.onBeforeRequest({ urls: ["file://*"] }, (_details, callback) => callback({ cancel: true }));
  return { win, target };
}

export function openReferenceWindow(options) {
  const result = createReferenceWindow(options);
  if (!result) return false;
  void result.win.loadURL(result.target.url).catch(options.onError ?? (() => {}));
  return true;
}

/** Load the exact approved UI graph; execution is separately submitted via /prompt. */
export async function openDirectorWorkflowWindow({ BrowserWindow, parent, workflow, timeoutMs = 45_000 }) {
  const result = createReferenceWindow({ BrowserWindow, parent, url: DIRECTOR_ORIGIN });
  if (!result) return false;
  const { win } = result;
  let timer;
  let onClosed;
  const unavailable = new Promise((_resolve, reject) => {
    onClosed = () => reject(new Error("LTX Director was closed before the workflow was ready. No render was submitted."));
    win.once?.("closed", onClosed);
    timer = setTimeout(() => reject(new Error("LTX Director did not load the approved workflow in time. No render was submitted.")), timeoutMs);
  });
  try {
    const loaded = await Promise.race([unavailable, (async () => {
      await win.loadURL(DIRECTOR_ORIGIN);
      return win.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 20000;
    let directorApp;
    while (Date.now() < deadline) {
      directorApp = window.comfyAPI?.app?.app ?? window.app ?? window.comfyApp;
      const splash = document.getElementById('splash-loader');
      const loading = splash && getComputedStyle(splash).display !== 'none' && getComputedStyle(splash).visibility !== 'hidden';
      if (!loading && directorApp?.graph && typeof directorApp.loadGraphData === 'function') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!directorApp?.graph || Date.now() >= deadline) throw new Error('LTX Director editor did not become ready.');
    await directorApp.loadGraphData(${JSON.stringify(workflow)});
    const loadedDirector = directorApp.graph._nodes.find(node => node.type === 'LTXDirector');
    if (!loadedDirector) throw new Error('The approved Director node did not load.');
    const expected = JSON.parse(loadedDirector.properties.timeline_data).segments.filter(segment => segment.imageFile || segment.imageB64).map(segment => segment.id);
    const imageDeadline = Date.now() + 20000;
    let imagesReady = false;
    while (Date.now() < imageDeadline) {
      const segments = loadedDirector._timelineEditor?.timeline?.segments;
      imagesReady = !!segments && expected.every(id => {
        const segment = segments.find(item => item.id === id);
        return segment?.imgObj?.complete && segment.imgObj.naturalWidth > 0;
      });
      if (imagesReady) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!imagesReady) throw new Error('Starting images could not be displayed in LTX Director. No render was submitted.');
    const canvas = directorApp.canvas;
    if (canvas?.ds && loadedDirector.size) {
      canvas.ds.scale = Math.max(0.1, Math.min(0.9, (canvas.canvas.clientWidth - 100) / loadedDirector.size[0], (canvas.canvas.clientHeight - 120) / loadedDirector.size[1]));
      canvas.centerOnNode?.(loadedDirector);
      canvas.setDirty?.(true, true);
    }
    return true;
  })()`);
    })()]);
    if (loaded) win.focus();
    return loaded === true;
  } catch (error) {
    if (win.isDestroyed?.() === false) win.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
    win.removeListener?.("closed", onClosed);
  }
}
