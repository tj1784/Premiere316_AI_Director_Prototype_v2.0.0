import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "client", "dist");
const assets = path.join(dist, "assets");
const vendor = path.join(dist, "vendor");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(assets, { recursive: true });
fs.mkdirSync(vendor, { recursive: true });

const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const result = spawnSync(process.execPath, [tsc, "-p", path.join(root, "scripts", "tsconfig.portable.json")], {
  cwd: root,
  stdio: "inherit"
});
if (result.status !== 0) process.exit(result.status || 1);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

for (const file of walk(assets).filter((item) => item.endsWith(".js"))) {
  let code = fs.readFileSync(file, "utf8");
  // The browser-native portable bundle cannot import CSS modules. Collect all
  // source styles into the one stylesheet linked by index.html, then remove
  // every side-effect CSS import emitted by TypeScript.
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  code = code.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (_, start, spec, end) => {
    if (/\.(?:js|mjs|json|css)$/.test(spec)) return `${start}${spec}${end}`;
    return `${start}${spec}.js${end}`;
  });
  code = code.replace(/(import\s+["'])(\.\.?\/[^"']+)(["'])/g, (_, start, spec, end) => {
    if (/\.(?:js|mjs|json|css)$/.test(spec)) return `${start}${spec}${end}`;
    return `${start}${spec}.js${end}`;
  });
  fs.writeFileSync(file, code);
}

const clientSource = path.join(root, "client", "src");
const stylesheet = walk(clientSource)
  .filter((file) => file.endsWith(".css"))
  .sort((left, right) => {
    const rootStyles = path.join(clientSource, "styles.css");
    if (left === rootStyles) return -1;
    if (right === rootStyles) return 1;
    return left.localeCompare(right);
  })
  .map((file) => fs.readFileSync(file, "utf8").trim())
  .filter(Boolean)
  .join("\n\n");
fs.writeFileSync(path.join(dist, "styles.css"), `${stylesheet}\n`);
fs.copyFileSync(path.join(root, "node_modules", "react", "umd", "react.production.min.js"), path.join(vendor, "react.production.min.js"));
fs.copyFileSync(path.join(root, "node_modules", "react-dom", "umd", "react-dom.production.min.js"), path.join(vendor, "react-dom.production.min.js"));

fs.writeFileSync(path.join(vendor, "react.mjs"), `
const React = globalThis.React;
if (!React) throw new Error("React UMD failed to load");
export default React;
export const { Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createFactory, createRef, forwardRef,
  isValidElement, lazy, memo, startTransition, useCallback, useContext, useDebugValue,
  useDeferredValue, useEffect, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect,
  useMemo, useReducer, useRef, useState, useSyncExternalStore, useTransition, version } = React;
`);

fs.writeFileSync(path.join(vendor, "react-dom-client.mjs"), `
const ReactDOM = globalThis.ReactDOM;
if (!ReactDOM) throw new Error("ReactDOM UMD failed to load");
export const createRoot = ReactDOM.createRoot;
export const hydrateRoot = ReactDOM.hydrateRoot;
`);

fs.writeFileSync(path.join(vendor, "zustand.mjs"), `
import React from "react";
const identity = (state) => state;
export function create(createState) {
  const listeners = new Set();
  let state;
  const api = {
    setState(partial, replace = false) {
      const next = typeof partial === "function" ? partial(state) : partial;
      if (Object.is(next, state)) return;
      const previous = state;
      state = replace || typeof next !== "object" || next === null ? next : Object.assign({}, state, next);
      listeners.forEach((listener) => listener(state, previous));
    },
    getState() { return state; },
    getInitialState() { return initialState; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
  state = createState(api.setState, api.getState, api);
  const initialState = state;
  function useBoundStore(selector = identity) {
    return React.useSyncExternalStore(api.subscribe, () => selector(api.getState()), () => selector(api.getInitialState()));
  }
  return Object.assign(useBoundStore, api);
}
export default create;
`);

fs.writeFileSync(path.join(dist, "index.html"), `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#070a10" />
  <title>Premiere316 · AI Director</title>
  <link rel="stylesheet" href="/styles.css" />
  <script src="/vendor/react.production.min.js"></script>
  <script src="/vendor/react-dom.production.min.js"></script>
  <script type="importmap">{
    "imports": {
      "react": "/vendor/react.mjs",
      "react-dom/client": "/vendor/react-dom-client.mjs",
      "zustand": "/vendor/zustand.mjs"
    }
  }</script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/main.js"></script>
</body>
</html>`);

console.log(`Portable build complete: ${dist}`);
