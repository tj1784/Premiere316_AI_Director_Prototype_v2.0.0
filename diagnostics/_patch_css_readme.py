from pathlib import Path

css = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\client\src\styles.css")
text = css.read_text(encoding="utf-8")
block = '''
.ltx-generate-option { display: grid; gap: 2px; padding-right: 8px; border-right: 1px solid var(--line); color: #9db3d0; font-size: 8px; letter-spacing: .08em; }
.ltx-generate-option select { min-width: 220px; height: 26px; margin-top: 2px; }
.ltx-timeline-header-meta { display: grid; justify-items: end; gap: 4px; }
.ltx-timeline-toggle { border: 1px solid #5a4b86; background: #1a1430; color: #d7c8ff; height: 26px; padding: 0 10px; border-radius: 4px; cursor: pointer; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.ltx-timeline-toggle:hover { border-color: #b393ff; }
.ltx-preview-player { flex: 1; min-height: 220px; display: flex; flex-direction: column; background: #070b11; }
.ltx-preview-player.empty { display: grid; place-items: center; color: #7a8798; }
.ltx-preview-stage { flex: 1; min-height: 180px; display: grid; place-items: center; background: #05080d; }
.ltx-preview-stage video { width: 100%; height: 100%; max-height: 320px; object-fit: contain; background: #000; }
.ltx-preview-placeholder { display: grid; gap: 6px; text-align: center; color: #8b97a8; }
.ltx-preview-transport { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--line); }
.ltx-preview-transport small { color: #7f8b9c; }
.ltx-reference-header-actions { display: flex; align-items: center; gap: 8px; }
.ltx-panel-tabs { display: flex; gap: 0; border: 1px solid #3a465a; border-radius: 4px; overflow: hidden; }
.ltx-panel-tabs button { border: 0; background: transparent; color: #8b97a8; height: 24px; padding: 0 9px; font-size: 8px; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; }
.ltx-panel-tabs button.active { background: #2a1f4a; color: #d7c8ff; }
.ltx-library-help { margin: 8px 0 0; color: #7f8b9c; font-size: 8px; }
.ltx-library-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 9px; }
.ltx-library-card { display: grid; gap: 5px; padding: 6px; border: 1px solid #344155; border-radius: 7px; background: #0a1018; color: #d8e1ee; text-align: left; cursor: pointer; }
.ltx-library-card .ltx-reference-thumb { height: 88px; }
.ltx-library-card small { color: #8190a3; font-size: 7px; }
.ltx-library-card.active { border-color: #b393ff; box-shadow: 0 0 0 1px var(--purple-bright), 0 0 16px rgba(113,80,223,.22); background: #161328; }
.ltx-library-card.active small { color: #d0bfff; }
'''
if ".ltx-library-card.active" not in text:
    # insert before Embedded ComfyUI comment
    marker = "/* Embedded ComfyUI */"
    if marker not in text:
        raise SystemExit("css marker missing")
    text = text.replace(marker, block + "\n" + marker, 1)
    css.write_text(text, encoding="utf-8")
    print("added ltx css")
else:
    print("css already present")

readme = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Premiere316\00_READ_ME_GENERATION.txt")
rt = readme.read_text(encoding="utf-8")
note = '''
------------------------------------------------
PREMIERE LTX DIRECTOR GENERATE OPTION (2026-08-19)
------------------------------------------------
Harrowing AAA I2V · segmented
  Catalog copy (do not edit the live Comfy canvas AAA):
    02_GENERATE_VIDEO_LTX_2.5_Harrowing_AAA.json
  Premiere Queue All compiler target (one I2V job per segment):
    LTX2.5_Premiere316.json
  Live Randall canvas left untouched:
    ..\\LTX_2.5_Harrowing_AAA.json

Queue All on H01-S01-C01 submits 18 segment jobs, not one 144s job.
Project-wide Harrowing I2V is 406 segment jobs across 153 clips / 38 scenes.

'''
if "02_GENERATE_VIDEO_LTX_2.5_Harrowing_AAA.json" not in rt:
    readme.write_text(rt.rstrip() + "\n" + note, encoding="utf-8")
    print("updated generation readme")
else:
    print("readme already updated")
