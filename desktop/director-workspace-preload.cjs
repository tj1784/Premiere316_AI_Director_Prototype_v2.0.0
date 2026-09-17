"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const token = process.argv.find((argument) => argument.startsWith("--premiere316-director-workspace="))?.split("=")[1];
if (/^[a-f0-9-]{36}$/.test(token || "")) {
  const close = () => ipcRenderer.send(`p316:director-workspace:${token}:close`);
  contextBridge.exposeInMainWorld("directorWorkspace", Object.freeze({ close }));
  let latest = null;
  const render = () => {
    if (!latest) return;
    const title = document.getElementById("scene-title");
    const status = document.getElementById("status");
    if (title) { title.textContent = String(latest.title || "LTX Director"); title.title = title.textContent; }
    if (status) status.textContent = String(latest.status || "");
  };
  ipcRenderer.on(`p316:director-workspace:${token}:state`, (_event, state) => { latest = state; render(); });
  window.addEventListener("DOMContentLoaded", () => {
    document.getElementById("back-to-premiere")?.addEventListener("click", close);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } });
    render();
  });
}
