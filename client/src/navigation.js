export const ASSET_TABS = Object.freeze(["prompts", "generate", "characters", "ost", "library"]);
export const DIRECT_TABS = Object.freeze(["sequence", "ltx", "comfyui"]);

export const TOP_LEVEL_ROUTES = Object.freeze({
  screenplay: "/screenplay",
  assets: "/assets/prompts",
  sound: "/sound",
  storyboard: "/storyboard",
  direct: "/direct/sequence",
  edit: "/edit",
  generate: "/generate",
  master: "/master",
  export: "/export"
});

function cleanPath(pathname) {
  const value = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  if (value === "/") return value;
  return `/${value.split("/").filter(Boolean).join("/")}`.toLowerCase();
}

function validRememberedTab(value, allowed, fallback) {
  const normalized = String(value || "").toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

export function resolveProductionRoute(pathname, preferences = {}) {
  const path = cleanPath(pathname);
  const assetsTab = validRememberedTab(preferences.assetsTab, ASSET_TABS, "prompts");
  const directTab = validRememberedTab(preferences.directTab, DIRECT_TABS, "sequence");

  if (path === "/") return "/edit";
  if (path === "/assets") return `/assets/${assetsTab}`;
  if (path === "/direct") return `/direct/${directTab}`;
  if (path === "/media") return "/direct/sequence";
  if (path === "/ltx-director") return "/direct/ltx";
  if (path === "/comfy" || path === "/comfyui") return "/direct/comfyui";
  if (ASSET_TABS.some((tab) => path === `/assets/${tab}`)) return path;
  if (DIRECT_TABS.some((tab) => path === `/direct/${tab}`)) return path;
  if (Object.values(TOP_LEVEL_ROUTES).includes(path)) return path;
  return "/edit";
}

export function routeSection(route) {
  const path = resolveProductionRoute(route);
  if (path.startsWith("/assets/")) return "assets";
  if (path.startsWith("/direct/")) return "direct";
  return path.slice(1);
}

export function routeSubtab(route) {
  const parts = resolveProductionRoute(route).split("/").filter(Boolean);
  return parts.length > 1 ? parts[1] : null;
}

export function routeForShorts(route) {
  return resolveProductionRoute(route) === "/screenplay" ? "/direct/sequence" : resolveProductionRoute(route);
}
