from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\server\qwen-tts.js")
t = p.read_text(encoding="utf-8")
print("len", len(t.splitlines()))
for i, line in enumerate(t.splitlines(), 1):
    if any(k in line for k in ["createQwenTtsGeneration", "attachToCue", "cueId", "segmentId", "function create", "bindQwenTts"]):
        print(f"{i}:{line[:200]}")
