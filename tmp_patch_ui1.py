from pathlib import Path
p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\client\src\components\LtxDirectorWorkspace.tsx")
t = p.read_text(encoding="utf-8")
print("has loadWorkflowLibrary", "const loadWorkflowLibrary" in t)
print("has HARROWING default", "HARROWING OF HELL.json" in t)
print("has queue body", 'body: JSON.stringify(mode === "selected"' in t)
print("has queueMode click", "queue(queueMode)" in t)
