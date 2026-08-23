from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0")
print("==== files")
for p in (root / "server").rglob("*"):
    if p.suffix not in {".js", ".mjs"}:
        continue
    if "qwen" in p.name.lower() or "tts" in p.name.lower():
        print(p.relative_to(root))

idx = (root / "server/index.js").read_text(encoding="utf-8")
print("==== index.js qwen-tts")
for i, line in enumerate(idx.splitlines(), 1):
    if "qwen-tts" in line or "qwenTts" in line or "attachToCue" in line or "cueId" in line and "tts" in line.lower():
        print(f"{i}:{line[:200]}")

for name in ["qwen-tts.js", "qwenTts.js", "sound.js"]:
    p = root / "server" / name
    if p.exists():
        print("====", name, "exists", p.stat().st_size)
