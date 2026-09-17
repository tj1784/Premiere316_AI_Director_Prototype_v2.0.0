import { join } from 'node:path';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createProjectLibrary } from '../../../desktop/project-library.mjs';

let service: ReturnType<typeof createProjectLibrary>;
export function projectLibraryService() {
  service ??= createProjectLibrary({ root: process.env.PREMIERE316_PROJECT_ROOT || process.cwd(), publicRoot: process.env.PREMIERE316_PUBLIC_ROOT || join(process.cwd(), 'public'), mediaRoots: [process.env.PREMIERE316_MEDIA_ROOT, process.env.PREMIERE316_IMPORT_ROOT].filter((root): root is string => Boolean(root)) });
  return service;
}
function localRequest(request: Request) {
  const url = new URL(request.url);
  if (process.env.VERCEL || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return false;
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && !['cross-site'].includes(request.headers.get('sec-fetch-site') ?? '');
}
export async function projectStorageRequest(request: Request) {
  if (!localRequest(request)) return new Response('Local project storage only', { status: 403 });
  try {
    const service = projectLibraryService();
    if (request.method === 'GET') {
      const slug = new URL(request.url).searchParams.get('project');
      const pictureId = new URL(request.url).searchParams.get('picture');
      return Response.json(pictureId ? service.libraryForPicture(pictureId) : slug ? service.library(slug) : { available: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const input = await request.json();
    if (!['read', 'write'].includes(input.operation) || (input.value !== null && typeof input.value !== 'string')) return new Response('Invalid request', { status: 400 });
    if (input.knownIds !== undefined && (!Array.isArray(input.knownIds) || input.knownIds.some((id: unknown) => typeof id !== 'string'))) return new Response('Invalid picture membership', { status: 400 });
    const value = input.operation === 'read' ? service.readState(input.value) : service.writeState(input.value, input.knownIds);
    return Response.json({ value }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Project storage failed' }, { status: 500 });
  }
}
const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', pdf: 'application/pdf', json: 'application/json', txt: 'text/plain', md: 'text/plain', fountain: 'text/plain' };
export function projectMediaRequest(request: Request) {
  if (!localRequest(request)) return new Response('Local project media only', { status: 403 });
  try {
    const url = new URL(request.url);
    const file = projectLibraryService().mediaFile(url.searchParams.get('project'), url.searchParams.get('file'));
    const size = statSync(file).size;
    const headers = { 'Content-Type': mime[file.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = match ? Number(match[1]) : NaN;
      const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!Number.isSafeInteger(start) || start < 0 || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...headers, 'Content-Length': String(size) } });
  } catch { return new Response('Project media not found', { status: 404 }); }
}
