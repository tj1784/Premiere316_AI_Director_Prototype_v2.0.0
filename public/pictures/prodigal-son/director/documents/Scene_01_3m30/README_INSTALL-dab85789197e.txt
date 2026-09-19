PRODIGAL SON — SCENE 01: TEMPLE AND THE GATHERING
Varied camera angles | 16 segments | 3 minutes 30 seconds | 24 fps

This replaces the earlier Scene 01 opening. The lost-sheep and lost-coin
parables have been removed. Scene_01_Shot_Plan.csv lists the exact shot order,
durations, and matching images. Scene_01_Updated_Screenplay.md is the
screenplay source for this replacement. Scene_01_Complete_Prompts.md contains
the readable global and per-shot prompts. The images include seven retained
originals and nine new angles (16 unique stills in total). Keep their supplied
dimensions: originals 1920x800, new images 1942x809, approximately 2.4:1.

COMFYUI

1. Extract the entire ZIP.
2. Copy/merge the included input/prodigal_son folder into ComfyUI/input.
   Keep its subfolders intact. Append files; do not delete existing folders.
   If an older file already exists, keep it when it is identical. If the
   existing bytes differ, keep a backup and resolve the name conflict before
   opening the workflow; do not silently overwrite a different asset.
3. Open Scene_01_Temple_and_the_Gathering_Varied_Angles.json in ComfyUI as
   the replacement Scene 01 workflow. Save your old workflow separately.
4. Check that all 16 timeline thumbnails load and the duration is 210 seconds.
   Distilled remains OFF. Tiled decode remains ON. The supplied model and
   sampling settings are retained.

The JSON is ready for review in ComfyUI. No video render is included.

PREMIERE316

Give the complete ZIP and APPLY_TO_PREMIERE316.md to your local Codex.
That file supplies the implementation prompt for appending the images and
replacing only PS-S01 in the active project. It preserves the other scenes,
character assets, and voice references.

The existing Scene 01 import script targets the previous 22-shot package;
it needs the narrow adaptation described in APPLY_TO_PREMIERE316.md before
it can import this 16-shot package. Simply opening this ZIP does not update
Premiere316. Importing the new stills also does not approve them automatically.

CUEBOARD

Earlier Scene 01 performance proposals should be marked stale. Review and
approve the new screenplay version before requesting a fresh Cueboard AI
review. This package itself does not run the app's AI review or alter a live
project. No separate dialogue TTS is required or included.

EXISTING REFERENCES — KEEP YOUR LOCAL FILES

These original reference paths are retained in the workflow but their files
are not included in the ZIP:

  whatdreamscost/1a7cf183faa1-PS-CHR-JESUS.png
  whatdreamscost/87ed7075b0e7-PS-LOC-HILLSIDE.png
  voices/shared/JESUS.flac
  prodigal_son/voices/PHARISEE-reference.flac
  prodigal_son/voices/SCRIBE-reference.flac

Keep/reconnect these existing files in your current ComfyUI input/media setup.
The new scene images do not replace the original character/location reference
boards or approved voices. If one is missing, reconnect the matching existing
reference; do not substitute a different identity or generate separate TTS.

IMAGE INDEX

Open Image_Index.html after extracting the ZIP to see all 16 images in shot
order. Image_Manifest.json records each image path, dimensions and hash.
