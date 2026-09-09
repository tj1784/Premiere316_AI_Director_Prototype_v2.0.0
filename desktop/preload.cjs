"use strict";

/**
 * Sandboxed preload cannot require local modules. Channel names stay inline.
 * Renderer sees only this typed bridge — no fs, spawn, or model-root access.
 */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const channels = {
  imageSearchReferences: "p316:image:searchReferences",
  imageImportWebReference: "p316:image:importWebReference",
  filmStart: "p316:film:start",
  filmStatus: "p316:film:status",
  filmStop: "p316:film:stop",
  catalogGet: "p316:catalog:get",
  enginesStop: "p316:engines:stop",
  imageManifests: "p316:image:manifests",
  imagePrepareDrafts: "p316:image:prepareDrafts",
  imageGenerateDraft: "p316:image:generateDraft",
  imageRecoverDrafts: "p316:image:recoverDrafts",
  imageEncodeDraftPrompts: "p316:image:encodeDraftPrompts",
  imageProgress: "p316:image:progress",
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
  mediaDiscover: "p316:media:discover",
  mediaImportVideo: "p316:media:importVideo",
  mediaImportAudio: "p316:media:importAudio",
  mediaExportLite: "p316:media:exportLite",
  mediaExportPlus: "p316:media:exportPlus",
  mediaOpenFolder: "p316:media:openFolder",
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
  film: { start: (input) => invoke(channels.filmStart, input), status: (jobId) => invoke(channels.filmStatus, jobId), stop: () => invoke(channels.filmStop) },
  catalog: {
    get: (query) => invoke(channels.catalogGet, query ?? {}),
  },
  stills: {
    unload: () => invoke(channels.enginesStop),
  },
  image: {
    searchReferences: (query) => invoke(channels.imageSearchReferences, query),
    importWebReference: (input) => invoke(channels.imageImportWebReference, input),
    prepareDrafts: (input) => invoke(channels.imagePrepareDrafts, input),
    generateDraft: (input) => invoke(channels.imageGenerateDraft, input),
    recoverDrafts: (input) => invoke(channels.imageRecoverDrafts, input),
    encodeDraftPrompts: (input) => invoke(channels.imageEncodeDraftPrompts, input),
    onProgress: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, progress) => {
        if (!progress || ![progress.pictureId, progress.assetId, progress.preparedAssetId].every((value) => typeof value === "string" && value.length > 0 && value.length <= 512) || typeof progress.message !== "string" || !progress.message.length || progress.message.length > 500 || !Number.isFinite(progress.at)) return;
        callback({ pictureId: progress.pictureId, assetId: progress.assetId, preparedAssetId: progress.preparedAssetId, message: progress.message, at: progress.at });
      };
      ipcRenderer.on(channels.imageProgress, listener);
      return () => ipcRenderer.removeListener(channels.imageProgress, listener);
    },
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
  media: {
    discover: () => invoke(channels.mediaDiscover),
    importVideo: () => invoke(channels.mediaImportVideo),
    importAudio: () => invoke(channels.mediaImportAudio),
    exportLite: (input) => invoke(channels.mediaExportLite, input ?? {}),
    exportPlus: (input) => invoke(channels.mediaExportPlus, input ?? {}),
    openFolder: () => invoke(channels.mediaOpenFolder),
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
