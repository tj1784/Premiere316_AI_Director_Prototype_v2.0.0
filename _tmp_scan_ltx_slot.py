from pathlib import Path
root = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0")
needles = ["dialogueCue", "attachToCue", "exactDialogue", "cueId", "audioInput", "ltx.dialogueCue"]
for rel in [
    "server/index.js",
    "client/src/dialogue-cues.ts",
    "client/src/dialogue-cues.js",
]:
    p = root / rel
    if not p.exists():
        print("missing", rel)
        continue
    t = p.read_text(encoding="utf-8")
    print("====", rel)
    for i, l in enumerate(t.splitlines(), 1):
        if any(n in l for n in needles):
            print(f"{i}:{l[:200]}")

# ltx integration server
for p in (root / "server").rglob("*"):
    if p.suffix not in {".js", ".mjs"}:
        continue
    t = p.read_text(encoding="utf-8", errors="ignore")
    if "dialogueCue" in t or "attachToCue" in t:
        print("====", p.relative_to(root))
        for i, l in enumerate(t.splitlines(), 1):
            if "dialogueCue" in l or "attachToCue" in l or "cueId" in l:
                print(f"{i}:{l[:200]}")
