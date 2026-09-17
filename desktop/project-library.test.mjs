import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectLibrary } from './project-library.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'p316-folders-'));
  mkdirSync(join(root, 'projects'), { recursive: true });
  mkdirSync(join(root, 'public/pictures/a'), { recursive: true });
  writeFileSync(join(root, 'public/pictures/a/ref.png'), 'reference pixels');
  return { root, service: createProjectLibrary({ root }) };
}
const payload = pictures => JSON.stringify({ state: { pictures, activeId: pictures[0]?.id }, version: 0 });

test('each same-title picture owns a separate folder, and reopens with verified project media', () => {
  const { root, service } = fixture();
  const saved = JSON.parse(service.writeState(payload([
    { id: 'one', title: 'Same title', updatedAt: 1, production: { assets: [{ category: 'character', mediaUri: '/pictures/a/ref.png' }] } },
    { id: 'two', title: 'Same title', updatedAt: 1, thumbnailUrl: '/pictures/a/ref.png' },
  ])));
  const [a, b] = saved.state.pictures;
  assert.notEqual(a.projectLibrary.slug, b.projectLibrary.slug);
  assert.match(a.production.assets[0].mediaUri, /^\/api\/project-media/);
  const entry = service.library(a.projectLibrary.slug).entries[0];
  assert.equal(entry.category, 'characters');
  assert.equal(readFileSync(service.mediaFile(a.projectLibrary.slug, entry.file), 'utf8'), 'reference pixels');
  assert.ok(existsSync(join(root, 'public/pictures/a/ref.png')));
  assert.deepEqual(JSON.parse(service.readState()).state.pictures, saved.state.pictures);
  const again = JSON.parse(service.writeState(JSON.stringify(saved)));
  assert.equal(service.library(a.projectLibrary.slug).entries.length, 1);
  assert.equal(again.state.pictures[0].production.assets[0].mediaUri, a.production.assets[0].mediaUri);
});

test('legacy same-title projects are all imported and their originals remain unchanged', () => {
  const { root, service } = fixture();
  for (const slug of ['test', 'test_2', 'test_3']) {
    mkdirSync(join(root, 'projects', slug), { recursive: true });
    writeFileSync(join(root, 'projects', slug, 'project.json'), JSON.stringify({ name: 'Test', screenplay: { markdown: slug } }));
  }
  service.organizeLegacy();
  const imported = JSON.parse(service.readState());
  assert.equal(imported.state.pictures.length, 3);
  const saved = JSON.parse(service.writeState(JSON.stringify(imported)));
  assert.equal(new Set(saved.state.pictures.map(p => p.projectLibrary.slug)).size, 3);
  assert.equal(JSON.parse(readFileSync(join(root, 'projects/test_2/project.json'))).screenplay.markdown, 'test_2');
});

test('embedded media is extracted and no cross-project or traversal path is served', () => {
  const { service } = fixture();
  service.writeState(payload([{ id: 'one', title: 'one', thumbnailUrl: 'data:image/png;base64,cGl4ZWxz' }]));
  const entry = service.library('one').entries[0];
  assert.equal(readFileSync(service.mediaFile('one', entry.file), 'utf8'), 'pixels');
  assert.throws(() => service.mediaFile('../', entry.file));
  assert.throws(() => service.mediaFile('one', 'media/assets/../../picture.json'));
  assert.throws(() => service.mediaFile('one', 'media/assets/images/not-registered.png'));
});

test('failed state validation preserves earlier saved pictures; deleted pictures stay deleted', () => {
  const { service } = fixture();
  service.writeState(payload([{ id: 'one', title: 'one', updatedAt: 1 }]));
  assert.throws(() => service.writeState('{}'));
  assert.equal(JSON.parse(service.readState()).state.pictures.length, 1);
  service.writeState(payload([]));
  assert.equal(JSON.parse(service.readState()).state.pictures.length, 0);
});

test('newer disk edits win over stale browser data while new browser pictures are retained', () => {
  const { service } = fixture();
  service.writeState(payload([{ id: 'one', title: 'new title', updatedAt: 5 }]));
  const read = JSON.parse(service.readState(payload([{ id: 'one', title: 'old title', updatedAt: 1 }, { id: 'two', title: 'second', updatedAt: 1 }])));
  assert.equal(read.state.pictures.length, 2);
  assert.equal(read.state.pictures[0].title, 'new title');
});

test('stale tabs cannot overwrite newer pictures or delete pictures they have never loaded', () => {
  const { service } = fixture();
  service.writeState(payload([{ id: 'one', title: 'new', updatedAt: 5 }, { id: 'two', title: 'second', updatedAt: 1 }]));
  const saved = JSON.parse(service.writeState(payload([{ id: 'one', title: 'old', updatedAt: 1 }]), ['one']));
  assert.equal(saved.state.pictures.length, 2);
  assert.equal(saved.state.pictures[0].title, 'new');
  service.writeState(payload([]), ['one', 'two']);
  const reopened = JSON.parse(service.readState(payload([{ id: 'one', title: 'old', updatedAt: 1 }])));
  assert.equal(reopened.state.pictures.length, 0);
});
