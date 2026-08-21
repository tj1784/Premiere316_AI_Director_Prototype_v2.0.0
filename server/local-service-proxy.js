export function fixedUpstreamUrl(upstreamBase, requestPath = "/") {
  const base = new URL(upstreamBase);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error("Local service proxy requires HTTP or HTTPS");

  const incoming = new URL(String(requestPath || "/"), "http://premiere316.invalid");
  const basePath = base.pathname.replace(/\/+$/, "");
  const requestPathname = incoming.pathname.replace(/^\/+/, "");
  base.pathname = `${basePath}/${requestPathname}`.replace(/\/{2,}/g, "/");
  base.search = incoming.search;
  base.hash = "";
  return base;
}

export function fixedUpstreamWebSocketUrl(upstreamBase, requestPath = "/") {
  const target = fixedUpstreamUrl(upstreamBase, requestPath);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  return target;
}

export function proxyResponseHeaders(headers) {
  const blocked = new Set([
    "connection",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade"
  ]);
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([name, value]) => value != null && !blocked.has(name.toLowerCase()))
  );
}

export function isPermittedLocalGatewayRequest({ host, origin = "", protocol = "http" } = {}) {
  try {
    const normalizedProtocol = String(protocol || "http").replace(/:$/, "");
    const localUrl = new URL(`${normalizedProtocol}://${String(host || "")}`);
    const hostname = localUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!["127.0.0.1", "::1", "localhost"].includes(hostname)) return false;
    if (!origin) return true;
    return new URL(String(origin)).origin === localUrl.origin;
  } catch {
    return false;
  }
}

export function isEmbeddedLocalServiceReferer({ host, referer, protocol = "http", prefix = "/integrations/comfyui/" } = {}) {
  try {
    const source = new URL(String(referer || ""));
    return source.pathname.startsWith(prefix)
      && isPermittedLocalGatewayRequest({ host, origin: source.origin, protocol });
  } catch {
    return false;
  }
}

export function isClientWorkspacePath(pathname = "/") {
  const value = String(pathname || "/");
  return !value.startsWith("/api") && !value.startsWith("/media/");
}

export function sameLocalServiceEndpoint(left, right) {
  try {
    const normalize = (value) => {
      const url = new URL(String(value || ""));
      const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const host = ["127.0.0.1", "::1", "localhost"].includes(hostname) ? "loopback" : hostname;
      const port = url.port || (url.protocol === "https:" ? "443" : "80");
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.protocol}//${host}:${port}${pathname}`;
    };
    return normalize(left) === normalize(right);
  } catch {
    return false;
  }
}

export function rewriteLocalServiceLocation(location, upstreamBase, publicPrefix) {
  if (!location) return location;
  const upstream = new URL(upstreamBase);
  const target = new URL(String(location), upstream);
  if (target.origin !== upstream.origin) return null;
  const basePath = upstream.pathname.replace(/\/+$/, "");
  const suffix = target.pathname.startsWith(basePath) ? target.pathname.slice(basePath.length) : target.pathname;
  return `${String(publicPrefix || "").replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}${target.search}${target.hash}`;
}

export function webSocketCloseArguments(code, reason) {
  const value = Number(code);
  const standard = value >= 1000 && value <= 1014 && ![1004, 1005, 1006].includes(value);
  const application = value >= 3000 && value <= 4999;
  if (!standard && !application) return [];
  return [value, String(reason || "").slice(0, 100)];
}
