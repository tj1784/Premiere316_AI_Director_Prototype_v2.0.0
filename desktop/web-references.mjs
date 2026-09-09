import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export async function assertPublicUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['', '80', '443'].includes(url.port)) throw new Error('Reference must be a public HTTP(S) URL.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => {
    if (isIP(address) === 6) return !/^[23][0-9a-f]{3}:/i.test(address);
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127;
  })) throw new Error('Private network reference URLs are not allowed.');
  return url;
}

export async function fetchPublicReference(value, maxBytes = 2 * 1024 * 1024) {
  let url = await assertPublicUrl(value);
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Premiere316-reference-research/3.0' } });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { url = await assertPublicUrl(new URL(response.headers.get('location'), url).href); continue; }
    if (!response.ok || !response.body) throw new Error(`Reference request failed (${response.status}).`);
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    for (;;) { const { value: chunk, done } = await reader.read(); if (done) break; size += chunk.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error('Reference exceeds size limit.'); } chunks.push(chunk); }
    return { url: url.href, type: response.headers.get('content-type') ?? '', bytes: Buffer.concat(chunks) };
  }
  throw new Error('Too many reference redirects.');
}

const decode = (text) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '');

export async function searchVisualReferences(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300) throw new Error('Invalid reference search query.');
  const search = await fetchPublicReference(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const items = [...search.bytes.toString('utf8').matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/gi)].filter(([, attrs]) => /class=["'][^"']*result__a\b/.test(attrs)).slice(0, 6);
  const results = await Promise.allSettled(items.map(async ([, attrs, label]) => {
    const raw = decode(attrs.match(/href=["']([^"']+)["']/i)?.[1] ?? '');
    const link = new URL(raw, 'https://duckduckgo.com');
    const sourceUrl = link.searchParams.get('uddg') ?? link.href; const title = decode(label.replace(/<[^>]+>/g, '')).trim();
    const page = await fetchPublicReference(sourceUrl);
    const html = page.bytes.toString('utf8'); let imageUrl = ''; let description = '';
    for (const [meta] of html.matchAll(/<meta\b[^>]*>/gi)) {
      const attrs = Object.fromEntries([...meta.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(([, k, v]) => [k.toLowerCase(), decode(v)]));
      if (!imageUrl && ['og:image', 'twitter:image', 'twitter:image:src'].includes(attrs.property ?? attrs.name) && attrs.content) imageUrl = new URL(attrs.content, page.url).href;
      if (['og:description', 'description'].includes(attrs.property ?? attrs.name)) description = attrs.content ?? '';
    }
    if (!imageUrl || /favicon|logo[._/-]/i.test(imageUrl)) return null;
    await assertPublicUrl(imageUrl);
    return { title, sourceUrl: page.url, imageUrl, description: description.slice(0, 800) };
  }));
  return results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []).slice(0, 4);
}
