import type { ProjectStorageBackend } from './project-storage.ts';

export type ProjectLibraryLink = { slug: string; fileCount: number; missingCount: number };
export type ProjectLibrary = { title: string; slug: string; missing: string[]; entries: Array<{ name: string; file: string; category: string; uri: string; sha256: string; bytes: number }> };

export function withProjectFolders(browser: ProjectStorageBackend): ProjectStorageBackend {
  let available: Promise<boolean> | undefined;
  let knownIds: string[] = [];
  const enabled = () => available ??= fetch('/api/project-storage', { cache: 'no-store' }).then(async r => {
    if (r.status === 404 || r.status === 403 || !r.headers.get('content-type')?.includes('application/json')) return false;
    if (!r.ok) throw new Error('Project folders are unavailable.');
    return (await r.json()).available === true;
  });
  const exchange = async (operation: 'read' | 'write', value: string | null) => {
    const response = await fetch('/api/project-storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, value, knownIds }) });
    const result = await response.json();
    if (!response.ok || typeof result.value !== 'string') throw new Error(result.error || 'Project folder save failed.');
    knownIds = JSON.parse(operation === 'read' ? result.value : value!).state.pictures.map((picture: { id: string }) => picture.id);
    return result.value as string;
  };
  return {
    async getItem(key) {
      const saved = await browser.getItem(key);
      return await enabled() ? exchange('read', saved) : saved;
    },
    async setItem(key, value) {
      const saved = await enabled() ? await exchange('write', value) : value;
      await browser.setItem(key, saved);
      if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('premiere316:project-reconciled',{detail:saved}));
    },
    // Browser-state removal must never delete a project's files.
    removeItem: key => browser.removeItem(key),
  };
}
