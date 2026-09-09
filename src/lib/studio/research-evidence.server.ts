import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { PictureIntake } from "./picture-intake.ts";
import {
  MAX_RESEARCH_DOCUMENTS, MAX_RESEARCH_TEXT_CHARS, researchSearchQueries,
  suppliedResearchUrls, type ResearchEvidenceResult, type RetrievedResearchDocument,
} from "./research-evidence.ts";

type Address = { address: string; family: number };
type PageResponse = { status: number; location?: string; type: string; bytes: Uint8Array };
export type ResearchFetchDependencies = {
  resolve?: (hostname: string) => Promise<Address[]>;
  readPage?: (url: URL, address: Address, maxBytes: number) => Promise<PageResponse>;
};
export type ResearchPage = { url: string; type: string; text: string };
const MAX_PAGE_BYTES = 1024 * 1024;

export function isPublicResearchAddress(address: string): boolean {
  if (isIP(address) === 6) {
    return /^[23][0-9a-f]{3}:/i.test(address)
      && !/^2001:(?:db8|0*0):/i.test(address)
      && !/^2002:/i.test(address);
  }
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
    || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99)
    || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
    || a === 203 && b === 0 && c === 113);
}

async function publicResearchTarget(value: string, resolve: NonNullable<ResearchFetchDependencies["resolve"]>) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !["", "80", "443"].includes(url.port)) {
    throw new Error("Research sources must use public HTTP(S) URLs without credentials or custom ports.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname);
  if (!addresses.length || addresses.some(({ address }) => !isPublicResearchAddress(address))) {
    throw new Error("Private or reserved network research URLs are not allowed.");
  }
  return { url, address: addresses[0] };
}

function readPinnedPage(url: URL, address: Address, maxBytes: number): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    // Pin the verified destination so DNS cannot change between validation and connection.
    const pinnedLookup: RequestOptions["lookup"] = (_hostname, options, callback) => {
      if (options.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      lookup: pinnedLookup,
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Premiere316-source-research/3.0", "Accept": "text/html,text/plain,application/xhtml+xml", "Accept-Encoding": "identity" },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const type = String(response.headers["content-type"] ?? "");
      if (status >= 300 && status < 400) {
        response.resume();
        resolve({ status, location: response.headers.location, type, bytes: new Uint8Array() });
        return;
      }
      if (!/^(text\/(html|plain)|application\/xhtml\+xml)/i.test(type)) {
        response.resume();
        reject(new Error("This source is not a readable HTML or plain-text page. Import its text instead."));
        return;
      }
      if (Number(response.headers["content-length"]) > maxBytes) {
        response.destroy();
        reject(new Error("Research page exceeds the size limit."));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > maxBytes) {
          response.destroy();
          reject(new Error("Research page exceeds the size limit."));
        } else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status, type, bytes: Buffer.concat(chunks) }));
    });
    request.on("error", reject);
    request.end();
  });
}

export async function fetchResearchPage(value: string, dependencies: ResearchFetchDependencies = {}, maxBytes = MAX_PAGE_BYTES): Promise<ResearchPage> {
  const resolve = dependencies.resolve ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
  const readPage = dependencies.readPage ?? readPinnedPage;
  let target = await publicResearchTarget(value, resolve);
  for (let redirects = 0; redirects < 5; redirects++) {
    const page = await readPage(target.url, target.address, maxBytes);
    if (page.status >= 300 && page.status < 400 && page.location) {
      target = await publicResearchTarget(new URL(page.location, target.url).href, resolve);
      continue;
    }
    if (page.status < 200 || page.status >= 300) throw new Error(`Research source request failed (${page.status}).`);
    if (page.bytes.byteLength > maxBytes) throw new Error("Research page exceeds the size limit.");
    if (!/^(text\/(html|plain)|application\/xhtml\+xml)/i.test(page.type)) throw new Error("Research source must be readable HTML or plain text.");
    return { url: target.url.href, type: page.type, text: new TextDecoder().decode(page.bytes) };
  }
  throw new Error("Research source has too many redirects.");
}

export function decodeResearchEntities(text: string): string {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return entities[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

export function readableResearchPage(page: ResearchPage): { title: string; text: string } {
  if (/^text\/plain/i.test(page.type)) return { title: new URL(page.url).hostname, text: page.text.trim().slice(0, MAX_RESEARCH_TEXT_CHARS) };
  const title = decodeResearchEntities(page.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "") ?? new URL(page.url).hostname).trim();
  let html = page.text.replace(/<!--[^]*?-->/g, "").replace(/<(script|style|nav|header|footer|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  html = html.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1] ?? html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const text = decodeResearchEntities(html.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " "))
    .replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title: title.slice(0, 240), text: text.slice(0, MAX_RESEARCH_TEXT_CHARS) };
}

export function researchSearchLinks(html: string): string[] {
  const links: string[] = [];
  for (const [, attrs] of html.matchAll(/<a\b([^>]+)>[\s\S]*?<\/a>/gi)) {
    if (!/class=["'][^"']*result__a\b/.test(attrs)) continue;
    const raw = decodeResearchEntities(attrs.match(/href=["']([^"']+)["']/i)?.[1] ?? "");
    try {
      const url = new URL(raw, "https://duckduckgo.com");
      const target = url.searchParams.get("uddg") ?? url.href;
      if (/^https?:\/\//i.test(target) && !links.includes(target)) links.push(target);
    } catch { /* A malformed search result is not evidence. */ }
    if (links.length === 5) break;
  }
  return links;
}

export async function collectResearchEvidence(
  intake: PictureIntake,
  options: { allowSearch: boolean; fetchPage?: (url: string) => Promise<ResearchPage>; now?: () => number },
): Promise<ResearchEvidenceResult> {
  const fetchPage = options.fetchPage ?? fetchResearchPage;
  const deadline = Date.now() + 45000;
  let requests = 0;
  const getPage = async (url: string) => {
    if (Date.now() >= deadline || requests >= 12) throw new Error("The research retrieval budget was reached. Saved source excerpts remain available; retry or import additional text.");
    requests++;
    return fetchPage(url);
  };
  const warnings: string[] = [];
  const documents: RetrievedResearchDocument[] = [];
  const visited = new Set<string>();
  const fetchDocuments = async (urls: string[]) => {
    for (const url of urls) {
      if (visited.has(url) || documents.length >= MAX_RESEARCH_DOCUMENTS) continue;
      visited.add(url);
      try {
        const page = await getPage(url);
        const content = readableResearchPage(page);
        if (content.text.length < 160 || (content.text.match(/[\p{L}]+/gu)?.length ?? 0) < 25) throw new Error("No substantive source text was returned.");
        if (/^(access denied|just a moment|attention required|security check)/i.test(content.title)) throw new Error("This source requires browser access; import its text to use it.");
        if (!documents.some((document) => document.url === page.url)) documents.push({ ...content, url: page.url, retrievedAt: options.now?.() ?? Date.now() });
      } catch (error) {
        warnings.push(`${url}: ${error instanceof Error ? error.message : "Source could not be retrieved."}`);
      }
    }
  };
  await fetchDocuments(suppliedResearchUrls(intake));
  if (options.allowSearch) {
    for (const query of researchSearchQueries(intake)) {
      if (documents.length >= MAX_RESEARCH_DOCUMENTS) break;
      try {
        const results = await getPage(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
        const links = researchSearchLinks(results.text);
        if (!links.length) warnings.push(`No readable public search results for: ${query}`);
        await fetchDocuments(links.slice(0, 2));
      } catch (error) {
        warnings.push(`Search for ${query}: ${error instanceof Error ? error.message : "Search unavailable."}`);
      }
    }
  }
  return { documents, warnings };
}
