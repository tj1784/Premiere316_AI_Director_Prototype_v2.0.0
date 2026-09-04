"use strict";

/**
 * Sandboxed preload cannot require local modules. Channel names stay inline.
 * Renderer sees only this typed bridge — no fs, spawn, or model-root access.
 */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const channels = {
  catalogGet: "p316:catalog:get",
  enginesStop: "p316:engines:stop",
  imageManifests: "p316:image:manifests",
  imageSealAuthority: "p316:image:sealAuthority",
  imageAuthorityStatus: "p316:image:authorityStatus",
  imageAuthorizePrepared: "p316:image:authorizePrepared",
  imageApprovePrepared: "p316:image:approvePrepared",
  imageGeneratePrepared: "p316:image:generatePrepared",
  imageApproveCanonical: "p316:image:approveCanonical",
  imageRejectCanonical: "p316:image:rejectCanonical",
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
    unload: () => invoke(channels.enginesStop),
  },
  image: {
    manifests: () => invoke(channels.imageManifests),
    sealAuthority: (input) => invoke(channels.imageSealAuthority, input),
    authorityStatus: (input) => invoke(channels.imageAuthorityStatus, input),
    authorizePrepared: (input) => invoke(channels.imageAuthorizePrepared, input),
    approvePrepared: (input) => invoke(channels.imageApprovePrepared, input),
    generatePrepared: (input) => invoke(channels.imageGeneratePrepared, input),
    approveCanonical: (input) => invoke(channels.imageApproveCanonical, input),
    rejectCanonical: (input) => invoke(channels.imageRejectCanonical, input),
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
