import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { resolve, join, relative, dirname, basename, extname, isAbsolute } from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const slugify = value => String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 100) || 'untitled';
const json = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function atomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  renameSync(temp, file);
}
function inside(root, file) {
  const rel = relative(resolve(root), resolve(file));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
function files(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isSymbolicLink() ? [] : entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]);
}
const categoryNames = { CHR: 'characters', EXT: 'extras', LOC: 'locations', PRP: 'props', WAR: 'wardrobe', ANM: 'animals', FOD: 'food', GFX: 'graphics', GRM: 'grooming', SET: 'set-dressing' };
export function mediaCategory(file, hint = '') {
  const ext = extname(file).toLowerCase();
  if (['.wav', '.mp3', '.flac', '.ogg', '.m4a'].includes(ext)) return /voice|character/i.test(hint + file) ? 'voices' : 'audio';
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) return 'video';
  if (/frames|storyboard|starting-images/i.test(file)) return 'frames';
  const code = /PS-([A-Z]+)-/.exec(basename(file))?.[1];
  if (categoryNames[code]) return categoryNames[code];
  const normalized = slugify(hint).replaceAll('_', '-');
  const aliases = { character: 'characters', location: 'locations', prop: 'props', creature: 'animals', 'hair-makeup': 'grooming', 'set-dressing': 'set-dressing' };
  if (hint) return aliases[normalized] ?? normalized;
  if (['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) return 'images';
  if (['.zip', '.7z'].includes(ext)) return 'source-packages';
  return 'documents';
}

export function createProjectLibrary({ root, publicRoot = join(root, 'public'), mediaRoots = [] }) {
  const projects = join(root, 'projects');
  const stateFile = join(projects, '.studio-state.json');
  const allowed = [projects, publicRoot, join(root, 'artifacts'), join(root, 'media'), ...mediaRoots].map(resolvePath => resolve(resolvePath));
  const cache = new Map();
  function checked(rootPath, path) {
    const target = resolve(rootPath, path);
    if (!inside(rootPath, target)) throw new Error('Project path escapes its folder.');
    if (existsSync(target) && !inside(realpathSync(rootPath), realpathSync(target))) throw new Error('Project symlink escapes its folder.');
    return target;
  }
  function folder(slug) {
    if (!/^[a-z0-9][a-z0-9_-]{0,150}$/.test(slug)) throw new Error('Invalid project folder.');
    return checked(projects, slug);
  }
  function catalog() {
    if (!existsSync(projects)) return [];
    return readdirSync(projects, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink() && /^[a-z0-9][a-z0-9_-]*$/.test(e.name)).map(e => {
      const dir = folder(e.name);
      const manifest = existsSync(join(dir, 'asset-library.json')) ? json(join(dir, 'asset-library.json')) : null;
      if (manifest?.pictureId?.startsWith('folder_') && manifest.pictureId !== `folder_${e.name}`) manifest.pictureId = null;
      const legacy = existsSync(join(dir, 'project.json')) ? json(join(dir, 'project.json')) : null;
      let picture = existsSync(join(dir, 'picture.json')) ? json(join(dir, 'picture.json')) : null;
      if (picture?.id?.startsWith('folder_') && picture.id !== `folder_${e.name}`) picture = null;
      return { slug: e.name, dir, manifest, legacy, picture };
    });
  }
  function sourcePath(value, dir) {
    if (value.startsWith('/api/project-media?')) {
      const u = new URL(value, 'http://localhost');
      return mediaFile(u.searchParams.get('project'), u.searchParams.get('file'));
    }
    let candidates = [];
    if (value.startsWith('/pictures/') || value.startsWith('/stills/')) candidates.push(join(publicRoot, value.slice(1)));
    if (value.startsWith('/stills/')) candidates.push(...mediaRoots.map(r => join(r, 'stills', basename(value))), join(root, 'artifacts/stills', basename(value)));
    if (value.startsWith('media://stills/')) candidates.push(...mediaRoots.map(r => join(r, 'stills', basename(value))));
    if (/^media\//.test(value)) candidates.push(resolve(dir, value));
    if (isAbsolute(value) && !value.startsWith('/api/')) candidates.push(value);
    return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile() && allowed.some(base => existsSync(base) && inside(realpathSync(base), realpathSync(candidate))));
  }
  function url(slug, file) { return `/api/project-media?project=${encodeURIComponent(slug)}&file=${encodeURIComponent(file.replaceAll('\\', '/'))}`; }
  function copyAsset(source, dir, slug, hint, original, entries) {
    const stat = statSync(source);
    const key = `${source}:${stat.size}:${stat.mtimeMs}`;
    let digest = cache.get(key);
    if (!digest) { digest = hash(readFileSync(source)); cache.set(key, digest); }
    const existing = entries.find(entry => entry.sha256 === digest && existsSync(join(dir, entry.file)));
    if (existing) return existing.uri;
    const category = mediaCategory(source, hint);
    const safeName = basename(source).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-140);
    const rel = `media/assets/${category}/${digest.slice(0, 12)}-${safeName}`;
    const target = checked(dir, rel);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      if (hash(readFileSync(target)) !== digest) throw new Error(`Asset verification failed: ${safeName}`);
    }
    const uri = url(slug, rel);
    if (!entries.some(e => e.file === rel)) entries.push({ file: rel, category, name: basename(source), bytes: stat.size, sha256: digest, uri, source: original });
    return uri;
  }
  function localize(value, dir, slug, entries, missing, hint = '') {
    if (Array.isArray(value)) return value.map(v => localize(v, dir, slug, entries, missing, hint));
    if (value && typeof value === 'object') {
      const category = typeof value.category === 'string' ? value.category : hint;
      // Signed backend receipts remain verbatim; only the editable media references move.
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ['projectLibrary', 'canonicalProof', 'receipt', 'authoritySeal'].includes(k) ? v : localize(v, dir, slug, entries, missing, category)]));
    }
    if (typeof value !== 'string') return value;
    const inline = /^data:(image\/(?:png|jpeg|webp)|audio\/(?:wav|mpeg|ogg)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);
    if (inline) {
      const bytes = Buffer.from(inline[2], 'base64');
      const digest = hash(bytes);
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm' }[inline[1]];
      const category = mediaCategory(`inline.${ext}`, hint);
      const file = `media/assets/${category}/${digest}.${ext}`;
      const target = checked(dir, file);
      mkdirSync(dirname(target), { recursive: true });
      if (!existsSync(target)) writeFileSync(target, bytes);
      const uri = url(slug, file);
      if (!entries.some(e => e.file === file)) entries.push({ file, category, name: `${digest.slice(0, 12)}.${ext}`, bytes: bytes.length, sha256: digest, uri, source: 'embedded-media' });
      return uri;
    }
    if (value.length > 2048 || !/\.(png|jpe?g|webp|svg|wav|mp3|ogg|flac|mp4|mov|webm|m4a|pdf|docx|xlsx|fountain|zip)(?:[?#].*)?$/i.test(value)) return value;
    if (value.startsWith('/api/project-media?')) {
      try { const source = sourcePath(value, dir); if (source && value.startsWith(`/api/project-media?project=${encodeURIComponent(slug)}&`)) return value; } catch { /* Record missing media below. */ }
    }
    const source = sourcePath(value, dir);
    if (source) return copyAsset(source, dir, slug, hint, value, entries);
    if (/^(\/pictures\/|\/stills\/|media:|media\/)/.test(value) && !missing.includes(value)) missing.push(value);
    return value;
  }
  function organizeLegacy() {
    const results = [];
    for (const item of catalog()) {
      const { slug, dir, legacy } = item;
      for (const category of ['characters', 'locations', 'props', 'wardrobe', 'images', 'audio', 'video', 'frames', 'documents']) mkdirSync(join(dir, 'media/assets', category), { recursive: true });
      const entries = item.manifest?.entries ?? [];
      const missing = [];
      const hints = new Map();
      for (const asset of legacy?.assets?.items ?? []) for (const f of files(join(dir, 'media/assets'))) if (basename(f).startsWith(`${asset.id}.`) || basename(f).startsWith(`${asset.sourceAssetId}.`)) hints.set(f, asset.category);
      const registered = new Set(entries.map(e => resolve(dir, e.file)));
      const sources = files(join(dir, 'media')).filter(f => !registered.has(resolve(f)));
      sources.push(...files(join(dir, 'production')), ...files(join(dir, 'workflows')));
      if (slug === 'the_prodigal_son') sources.push(...files(join(publicRoot, 'pictures/prodigal-son')).filter(f => basename(f) !== '.gitattributes'));
      if (slug === 'moses_splitting_of_the_sea_and_crossing' && existsSync(join(publicRoot, 'stills/red-sea-visual-direction.jpg'))) sources.push(join(publicRoot, 'stills/red-sea-visual-direction.jpg'));
      for (const source of sources) {
        if (/asset[-_]index|README\.md/i.test(basename(source))) continue;
        copyAsset(source, dir, slug, hints.get(source) ?? '', source, entries);
      }
      const localized = localize(legacy, dir, slug, entries, missing);
      if (legacy) atomic(join(dir, 'project-linked.json'), localized);
      const manifest = { schemaVersion: 1, slug, pictureId: item.manifest?.pictureId ?? null, title: legacy?.name ?? item.picture?.title ?? slug, entries, missing };
      atomic(join(dir, 'asset-library.json'), manifest);
      results.push({ slug, files: entries.length, missing: missing.length });
    }
    return results;
  }
  function legacyPicture(item) {
    if (item.slug === 'the_prodigal_son') return null;
    const p = item.legacy;
    if (!p) return null;
    const image = item.manifest?.entries.find(e => /\.(png|jpg|jpeg|webp)$/i.test(e.name));
    return { id: `folder_${item.slug}`, title: p.name || item.slug, logline: '', genre: 'Drama', tone: 'Cinematic', format: '16:9', fps: p.settings?.fps || 24, runtimeMinutes: 5,
      createdAt: Date.parse(p.createdAt) || Date.now(), updatedAt: Date.parse(p.updatedAt) || Date.now(), stage: 'intake', thumbnailUrl: image?.uri ?? null,
      screenplayFountain: p.screenplay?.markdown || '', production: null, selectedEngine: {}, acts: [], scenes: [], characters: [], locations: [], props: [], wardrobe: [], vfx: [], shots: [], cues: [], voices: [], directorNotes: '', usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
      projectLibrary: { slug: item.slug, fileCount: item.manifest?.entries.length ?? 0, missingCount: item.manifest?.missing.length ?? 0 } };
  }
  function readState(incoming = null) {
    const disk = existsSync(stateFile) ? json(stateFile) : null;
    const browser = incoming ? JSON.parse(incoming) : null;
    const base = browser ?? disk ?? { state: {}, version: 0 };
    const pictures = new Map((disk?.state?.pictures ?? []).map(p => [p.id, p]));
    for (const picture of browser?.state?.pictures ?? []) {
      if (disk?.deletedPictureIds?.includes(picture.id)) continue;
      const saved = pictures.get(picture.id);
      if (!saved || picture.updatedAt >= saved.updatedAt) pictures.set(picture.id, picture);
    }
    const folders = catalog();
    for (const picture of pictures.values()) {
      if (picture.id.startsWith('folder_') && folders.some(i => i.slug === picture.id.slice(7))) picture.projectLibrary = { ...picture.projectLibrary, slug: picture.id.slice(7) };
    }
    for (const item of folders) {
      const title = slugify(item.legacy?.name ?? item.picture?.title);
      const uniqueTitle = folders.filter(i => slugify(i.legacy?.name ?? i.picture?.title) === title).length === 1;
      const existing = [...pictures.values()].find(p => p.projectLibrary?.slug === item.slug || (!p.projectLibrary && item.manifest?.pictureId && p.id === item.manifest.pictureId) || (uniqueTitle && !p.projectLibrary && !item.manifest?.pictureId && slugify(p.title) === title));
      if (existing) existing.projectLibrary = { slug: item.slug, fileCount: item.manifest?.entries.length ?? 0, missingCount: item.manifest?.missing.length ?? 0 };
      else if (!disk || !item.manifest?.pictureId) { const p = item.picture ?? legacyPicture(item); if (p) pictures.set(p.id, p); }
    }
    return JSON.stringify({ ...base, state: { ...base.state, pictures: [...pictures.values()] } });
  }
  function writeState(raw, knownIds) {
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.state?.pictures)) throw new Error('Invalid picture state.');
    const previous = existsSync(stateFile) ? json(stateFile) : null;
    const submitted = new Set(data.state.pictures.map(p => p.id));
    const deleted = new Set(previous?.deletedPictureIds ?? []);
    for (const older of previous?.state?.pictures ?? []) {
      if (!submitted.has(older.id)) {
        if (knownIds && !knownIds.includes(older.id)) data.state.pictures.push(older);
        else deleted.add(older.id);
      } else {
        const index = data.state.pictures.findIndex(p => p.id === older.id);
        if (older.updatedAt > data.state.pictures[index].updatedAt) data.state.pictures[index] = older;
      }
    }
    data.state.pictures = data.state.pictures.filter(p => !deleted.has(p.id));
    data.deletedPictureIds = [...deleted];
    const items = catalog();
    const used = new Map(items.map(i => [i.slug, i.manifest?.pictureId ?? i.picture?.id]));
    const ids = new Set();
    for (const picture of data.state.pictures) {
      if (typeof picture.id !== 'string' || !picture.id || ids.has(picture.id)) throw new Error('Missing or duplicate picture ID.');
      ids.add(picture.id);
      let slug = picture.id.startsWith('folder_') && items.some(i => i.slug === picture.id.slice(7)) ? picture.id.slice(7) : items.find(i => i.manifest?.pictureId === picture.id)?.slug;
      if (!slug && picture.id === 'pic_prodigal_son_20260909') slug = 'the_prodigal_son';
      if (!slug && picture.projectLibrary?.slug && (!used.get(picture.projectLibrary.slug) || used.get(picture.projectLibrary.slug) === picture.id)) slug = picture.projectLibrary.slug;
      if (!slug) slug = items.find(i => !used.get(i.slug) && slugify(i.legacy?.name ?? i.picture?.title) === slugify(picture.title))?.slug;
      slug ??= slugify(picture.title);
      if (used.has(slug) && used.get(slug) && used.get(slug) !== picture.id) slug += `_${hash(picture.id).slice(0, 8)}`;
      const dir = folder(slug);
      mkdirSync(dir, { recursive: true });
      used.set(slug, picture.id);
      const old = existsSync(join(dir, 'asset-library.json')) ? json(join(dir, 'asset-library.json')) : null;
      const entries = old?.entries ?? [], missing = [...(old?.missing ?? [])];
      const localized = localize(picture, dir, slug, entries, missing);
      localized.projectLibrary = { slug, fileCount: entries.length, missingCount: missing.length };
      for (const category of ['characters', 'locations', 'props', 'wardrobe', 'audio', 'video', 'frames', 'documents']) mkdirSync(join(dir, 'media/assets', category), { recursive: true });
      atomic(join(dir, 'asset-library.json'), { schemaVersion: 1, slug, pictureId: picture.id, title: picture.title, entries, missing });
      atomic(join(dir, 'picture.json'), localized);
      Object.assign(picture, localized);
    }
    atomic(stateFile, data);
    return JSON.stringify(data);
  }
  function mediaFile(slug, file) {
    const dir = folder(slug);
    if (typeof file !== 'string' || !file.startsWith('media/assets/')) throw new Error('Invalid project media path.');
    const target = checked(dir, file);
    const manifest = json(join(dir, 'asset-library.json'));
    if (!manifest.entries.some(e => e.file === file)) throw new Error('File is not registered to this project.');
    return target;
  }
  function library(slug) {
    const manifest = json(join(folder(slug), 'asset-library.json'));
    const unique = new Map();
    for (const entry of manifest.entries) {
      if (!unique.has(entry.sha256)) unique.set(entry.sha256, { ...entry, category: mediaCategory(entry.name, entry.category) });
    }
    return { ...manifest, entries: [...unique.values()] };
  }
  function libraryForPicture(id) {
    const item = catalog().find(i => i.manifest?.pictureId === id);
    if (!item) throw new Error('This picture has not been saved to its project folder yet.');
    return library(item.slug);
  }
  return { organizeLegacy, readState, writeState, mediaFile, library, libraryForPicture };
}
