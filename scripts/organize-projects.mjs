import { resolve } from 'node:path';
import { createProjectLibrary } from '../desktop/project-library.mjs';
const root = resolve(process.argv[2] || '.');
const service = createProjectLibrary({ root });
console.log(JSON.stringify(service.organizeLegacy(), null, 2));
