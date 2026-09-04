"use strict";

const { ipcRenderer } = require("electron");

const nonce = new URLSearchParams(globalThis.location.search).get("nonce") || "";
const channels = {
  get: "p316:confirmation:get",
  resolve: "p316:confirmation:resolve",
};

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value ?? "");
}

function resolveOnce(confirmed) {
  const buttons = document.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  ipcRenderer.invoke(channels.resolve, { nonce, confirmed }).catch(() => {
    buttons.forEach((button) => { button.disabled = false; });
  });
}

function trapFocus(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    resolveOnce(false);
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...document.querySelectorAll("button,[tabindex='0']")].filter((node) => !node.disabled && node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const list = document.getElementById("summary");
  const cancel = document.getElementById("cancel");
  const confirm = document.getElementById("confirm");
  try {
    const payload = await ipcRenderer.invoke(channels.get, { nonce });
    const summary = payload?.summary ?? {};
    setText("title", summary.title || "Confirm action");
    setText("message", summary.message || "Confirm this action?");
    setText("intent", summary.intent || "confirm");
    confirm.textContent = summary.confirmLabel || "Confirm";
    for (const line of Array.isArray(summary.lines) ? summary.lines : []) {
      const row = document.createElement("div");
      row.className = "row";
      const label = document.createElement("dt");
      label.textContent = String(line?.label ?? "Detail");
      const value = document.createElement("dd");
      value.textContent = String(line?.value ?? "");
      row.append(label, value);
      list.append(row);
    }
  } catch (error) {
    setText("message", error instanceof Error ? error.message : "Failed to load confirmation details.");
    confirm.disabled = true;
  }
  cancel.addEventListener("click", () => resolveOnce(false));
  confirm.addEventListener("click", () => resolveOnce(true));
  document.addEventListener("keydown", trapFocus);
  cancel.focus();
});
