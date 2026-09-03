/**
 * Serve local still plates written by the desktop backend / Vite stills plugin.
 * Renderer only ever sees /stills/<name> — never D:\AI\Models.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIRS = [join(process.cwd(), "artifacts", "stills"), "D:\\_Temp\\Premiere316\\stills-out"];

export default async function stillsMiddleware(
  event: { url: URL; req: { method: string } },
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const method = (event.req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return next();
  const path = event.url.pathname;
  if (!path.startsWith("/stills/")) return next();
  const name = decodeURIComponent(path.slice("/stills/".length));
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return new Response("bad still", { status: 400 });
  }
  const file = DIRS.map((dir) => join(dir, name)).find((candidate) => existsSync(candidate));
  if (!file) return new Response("missing still", { status: 404 });
  const headers = { "content-type": "image/png", "cache-control": "no-store" };
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(new Uint8Array(readFileSync(file)), { status: 200, headers });
}
