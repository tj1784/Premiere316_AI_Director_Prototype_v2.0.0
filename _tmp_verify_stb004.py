from pathlib import Path
root = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0")
print("==== index.ts")
t = (root / "client/src/contextual-agency/index.ts").read_text(encoding="utf-8")
for i, l in enumerate(t.splitlines(), 1):
    if "nextMissing" in l or "previousVersion" in l or "restoreForIntent" in l:
        print(f"{i}:{l}")
print("==== drawer imports + continue")
d = (root / "client/src/components/AssetActionDrawer.tsx").read_text(encoding="utf-8")
for i, l in enumerate(d.splitlines(), 1):
    if i <= 30 or "nextMissing" in l or "openAssetAction" in l or "continue" in l and "kind" in l or "dialogueAudio" in l:
        print(f"{i}:{l[:180]}")
print("==== direction")
s = (root / "client/src/components/StoryboardDirection.tsx").read_text(encoding="utf-8")
for i, l in enumerate(s.splitlines(), 1):
    if any(k in l for k in ["openLtxDirector", "fullPrompt", "Full preview", "Open in LTX", "storyboard-prompt-fullscreen"]):
        print(f"{i}:{l[:200]}")
print("==== workspace")
w = (root / "client/src/components/StoryboardWorkspace.tsx").read_text(encoding="utf-8")
for i, l in enumerate(w.splitlines(), 1):
    if any(k in l for k in ["openLtxDirector", "Open in LTX", "goDirectLtx", "const missing"]):
        print(f"{i}:{l[:200]}")
