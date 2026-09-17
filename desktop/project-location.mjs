import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function projectWorkspaceRoot({ override, developmentRoot, packaged, executable, userData, documents }) {
  if (override) return resolve(override);
  if (!packaged) return developmentRoot;
  const settings = join(userData, 'project-location.json');
  if (existsSync(settings)) {
    const { workspaceRoot } = JSON.parse(readFileSync(settings, 'utf8'));
    if (typeof workspaceRoot !== 'string' || !existsSync(join(workspaceRoot, 'projects'))) throw new Error('The configured project library is unavailable. Existing pictures have not been replaced.');
    return resolve(workspaceRoot);
  }
  // An unpacked build inside a checkout must use the same project library as dev.
  let candidate = dirname(executable);
  for (let i = 0; i < 4; i++, candidate = dirname(candidate)) {
    if (existsSync(join(candidate, 'projects')) && existsSync(join(candidate, 'desktop/main.mjs'))) return candidate;
  }
  return join(documents, 'Premiere316');
}
