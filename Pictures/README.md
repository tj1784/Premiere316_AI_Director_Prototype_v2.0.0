# Pictures

Open a picture folder to find its assets and working documents.

| Picture | Contents |
| --- | --- |
| [The Prodigal Son](The%20Prodigal%20Son/) | Asset-library shortcut, screenplay, inventory, reference board, generation records and character contact sheet |
| [Moses - The Red Sea](Moses%20-%20The%20Red%20Sea/) | Visual-direction images, collage, thumbnail shortcut, film sequence and render/project-snapshot shortcuts |
| [Unassigned](Unassigned/) | Recovered images whose picture ownership has not been confirmed |

The app's existing asset library remains at `public/pictures/prodigal-son` so URLs, package checksums and existing projects continue working. Windows shortcuts bring that library and the Red Sea render files into this folder without duplicating them. Original render folders include both media and diagnostic evidence; snapshots are historical, not a live project database. App-saved projects and newly generated media may also exist in the separate Premiere316 user profile, outside this repository; they are not relocated here.

Machine-specific `.lnk` files are local only. After cloning or moving this repository on Windows, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/link-picture-folders.ps1` from the repository root to recreate them. The relative links in each picture's README also work without shortcuts.

`organization-manifest.csv` records each relocated file's original path, current path, size and SHA-256 checksum. Unassigned recovery images remain local and are excluded from Git because the recovered set includes unidentified cache material.
