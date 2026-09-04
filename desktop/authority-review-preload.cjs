"use strict";

const { ipcRenderer } = require("electron");

const nonce = new URLSearchParams(globalThis.location.search).get("nonce") || "";
const channels = {
  get: "p316:authorityReview:get",
  resolve: "p316:authorityReview:resolve",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function renderTextWithSearch(pre, text, query) {
  if (!query) {
    pre.textContent = text;
    return;
  }
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index < 0) {
    pre.textContent = text;
    return;
  }
  pre.innerHTML = `${escapeHtml(text.slice(0, index))}<mark>${escapeHtml(text.slice(index, index + query.length))}</mark>${escapeHtml(text.slice(index + query.length))}`;
  pre.querySelector("mark")?.scrollIntoView({ block: "center" });
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
  const focusable = [...document.querySelectorAll("input,button,[tabindex='0']")].filter((node) => !node.disabled && node.offsetParent !== null);
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
  const pre = document.getElementById("review");
  const search = document.getElementById("search");
  const cancel = document.getElementById("cancel");
  const seal = document.getElementById("seal");
  let reviewDocument = "";
  try {
    const payload = await ipcRenderer.invoke(channels.get, { nonce });
    reviewDocument = String(payload?.reviewDocument ?? "");
    pre.textContent = reviewDocument || "No review document was provided. Cancel and reseal.";
  } catch (error) {
    pre.textContent = error instanceof Error ? error.message : "Failed to load authority review.";
    seal.disabled = true;
  }
  search.addEventListener("input", () => renderTextWithSearch(pre, reviewDocument, search.value.trim()));
  cancel.addEventListener("click", () => resolveOnce(false));
  seal.addEventListener("click", () => resolveOnce(true));
  document.addEventListener("keydown", trapFocus);
  cancel.focus();
});
