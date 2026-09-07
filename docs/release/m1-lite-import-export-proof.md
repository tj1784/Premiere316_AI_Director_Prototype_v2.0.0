# M1-LITE — imported media stitch export proof

Status: **GREEN**

Build: `p316-20260907223751-28fb28ffdbba`  
Tag: `m1-lite-import-export-p316-20260907223751-28fb28ffdbba`

This proves Premiere316 can take **approved imported** video and export a real MP4 through local FFmpeg. It does **not** prove native H3/LTX generation.

## Flow (packaged Premiere316.exe, isolated profile)

1. Import a 6s 512×288 H.264 fixture (UAT env path, same importer as the file dialog)
2. Probe + SHA-256 + copy into profile `imported/`
3. Bind to a Last Reel shot as origin=`imported`
4. Review and approve canonical imported take
5. Stitch timeline shows imported origin
6. Export MP4 via discovered local FFmpeg
7. Atomic `.tmp.mp4` → final path

## Export

- SHA-256 `d5378dee812906397761fe6c48aab759c84d94a0208a11847b50479390193d5d`
- 93934 bytes, 6.000s, 24 fps, 512×288, h264, 144 frames
- Provenance remains **imported**, never generated

## Not GREEN

Wave 5B / 6B / 7B / 8B unchanged. No ComfyUI, no :8188, no cloud, no FFmpeg download.
