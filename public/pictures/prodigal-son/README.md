# Prodigal Son picture media in this Site

The original production package is `Prodigal_Son_Complete_Package.zip`. Its own `README.md`, inventory files, and source digests remain inside that archive. This file documents the Site's separately optimized preview media; it is not the archive's original README or a replacement for its source records.

## Sources and previews

- `Prodigal_Son.fountain`, the Word screenplay, Excel inventory, JSON inventory, research notes, and ZIP are the direct source downloads. Source inventory IDs, scene associations, continuity rules, and approval states live in the picture data.
- `previews/PS-CHR-FATHER.webp` is the actual bundled Father asset preview. Other `PS-CHR-*` previews represent their corresponding imported character assets. `PS-CHR-PHARISEE` currently shares the `PS-EXT-LISTENERS` preview as its imported reference; that does not establish a separate approved face.
- The other `previews/PS-*` asset images are optimized WebP versions of the supplied/imported images. The source labels distinguish character uploads from ComfyUI asset imports. An image's presence is not an approval; imported iterations begin at `NEEDS_REVIEW`.
- The ten first/last frame WebPs are optimized copies of actual project frames. `previews/scene-frame-previews.json` records each frame's original PNG path, scene, shot, and endpoint. Those source PNG paths are provenance, and the Site serves the WebP previews.
- `previews/visual-development-reference.webp` is the optimized reference board used as the film thumbnail. It is not an individual character reference.
- `wallpapers/research-galilee.webp` is newly generated *environment atmosphere*, developed using the supplied visual board and town reference. It contains no principal character and does not establish an approved location, face, costume, or film frame.

## Keeping new imagery consistent

Use the relevant imported asset ID and its displayed preview when designing a principal, then check the inventory's required states and scene use. For the Father, anchor facial identity to `PS-CHR-FATHER.webp`; do not substitute a newly invented portrait. A generated composition remains a visual proposal until it is added as an iteration, compared against the original asset and continuity, and reviewed. Do not label a wallpaper or visual board as canonical media.

The asset library can remove an unselected, unreviewed draft iteration after a confirmation. Its history records that removal; original media bytes remain in place. Approved, reviewed, selected, depended-on, prepared, and native receipt-linked images are protected from this action. An Undo is available until a later edit changes the asset record.
