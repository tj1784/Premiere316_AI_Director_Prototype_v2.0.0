import type { ProjectLibrary } from '../src/lib/studio/project-library-client.ts';
export function mediaCategory(file: string, hint?: string): string;
export function createProjectLibrary(options: { root: string; publicRoot?: string; mediaRoots?: string[] }): {
  organizeLegacy(): Array<{ slug: string; files: number; missing: number }>;
  readState(incoming?: string | null): string;
  writeState(raw: string, knownIds?: string[]): string;
  mediaFile(slug: string | null, file: string | null): string;
  library(slug: string): ProjectLibrary;
  libraryForPicture(id: string): ProjectLibrary;
};
