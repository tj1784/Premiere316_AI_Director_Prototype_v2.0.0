# Project folders and app pictures

The local app links each picture ID to one folder in `projects/`. Titles may change or repeat without sharing another picture's folder.

- `picture.json`: the current app picture, including its project-local media URLs.
- `asset-library.json`: registered media, category, original source, SHA-256, and missing references.
- `media/assets/<category>/`: verified copies used by the app's **Project files** browser.
- `project.json`: original legacy project record, preserved unchanged.
- `project-linked.json`: the legacy record with available media references resolved into this project's library.

The app merges existing browser pictures with folder records on first load. Saves update the picture file and library before committing the browser copy. Original media and prior versions remain available. The file browser groups duplicate byte-identical copies as one file and never changes approval decisions.

`projects/.studio-state.json` holds the app snapshot and project membership. Deleting a picture from the app does not delete its media from disk. Unreadable storage blocks replacement with an empty state.

Run `node scripts/organize-projects.mjs` to register existing media, workflows, and production documents from the legacy folders. The importer reports missing references without fabricating replacements.

The unpacked desktop build uses the surrounding workspace's `projects` directory. Installed builds use `PREMIERE316_PROJECT_ROOT`, a `project-location.json` setting in the app profile (`{"workspaceRoot":"D:/path/to/workspace"}`), or Documents/Premiere316. Media access is limited to registered files and the local application origin; this filesystem library is disabled on Vercel.

Verification: `node --test desktop/project-library.test.mjs` and `node --experimental-strip-types --test src/lib/studio/project-storage.test.ts`.
