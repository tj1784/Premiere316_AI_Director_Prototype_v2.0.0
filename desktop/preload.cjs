"use strict";

/**
 * Sandboxed preload cannot require local modules. Channel names stay inline.
 * Renderer sees only this typed bridge — no fs, spawn, or model-root access.
 */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const channels = {
  catalogGet: "p316:catalog:get",
  stillsExpose: "p316:stills:expose",
  stillsWake: "p316:stills:wake",
  enginesStop: "p316:engines:stop",
  enginesBenchmark: "p316:engines:benchmark",
  enginesInspect: "p316:engines:inspect",
  dialogOpenImages: "p316:dialog:openImages",
  dialogOpenFolder: "p316:dialog:openFolder",
  dialogSaveText: "p316:dialog:saveText",
  dialogSaveMany: "p316:dialog:saveMany",
  filesReadImage: "p316:files:readImage",
  credentialsGet: "p316:credentials:get",
  credentialsSet: "p316:credentials:set",
  credentialsDelete: "p316:credentials:delete",
  appVersion: "p316:app:version",
  appBuildInfo: "p316:app:buildInfo",
  appModelRoot: "p316:app:modelRoot",
  appSystemStatus: "p316:app:systemStatus",
  zoomGet: "p316:zoom:get",
  zoomSet: "p316:zoom:set",
  zoomChanged: "p316:zoom:changed",
};

const ALLOWED = new Set(Object.values(channels));

function invoke(channel, ...args) {
  if (!ALLOWED.has(channel)) {
    return Promise.reject(new Error("Blocked desktop channel"));
  }
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld("premiere316", {
  isDesktop: true,
  catalog: {
    get: (query) => invoke(channels.catalogGet, query ?? {}),
  },
  stills: {
    expose: (input) => invoke(channels.stillsExpose, input),
    wake: () => invoke(channels.stillsWake),
    unload: () => invoke(channels.enginesStop),
    benchmark: (input) => invoke(channels.enginesBenchmark, input),
    inspect: (input) => invoke(channels.enginesInspect, input),
  },
  dialog: {
    openImages: () => invoke(channels.dialogOpenImages),
    openFolder: () => invoke(channels.dialogOpenFolder),
    saveText: (input) => invoke(channels.dialogSaveText, input),
    saveMany: (input) => invoke(channels.dialogSaveMany, input),
  },
  files: {
    fromDrop: (file) => {
      const filePath = typeof webUtils?.getPathForFile === "function" ? webUtils.getPathForFile(file) : "";
      if (!filePath) return Promise.resolve(null);
      return invoke(channels.filesReadImage, filePath);
    },
  },
  credentials: {
    get: (name) => invoke(channels.credentialsGet, name),
    set: (name, value) => invoke(channels.credentialsSet, name, value),
    delete: (name) => invoke(channels.credentialsDelete, name),
  },
  app: {
    version: () => invoke(channels.appVersion),
    buildInfo: () => invoke(channels.appBuildInfo),
    platform: process.platform,
    modelRootLabel: () => invoke(channels.appModelRoot),
    systemStatus: () => invoke(channels.appSystemStatus),
  },
  zoom: {
    get: () => invoke(channels.zoomGet),
    set: (factor) => invoke(channels.zoomSet, factor),
    onChanged: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, factor) => callback(factor);
      ipcRenderer.on(channels.zoomChanged, listener);
      return () => ipcRenderer.removeListener(channels.zoomChanged, listener);
    },
  },
});
