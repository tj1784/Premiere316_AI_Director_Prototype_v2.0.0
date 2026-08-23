from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0")

aa = (root / "client/src/contextual-agency/agency-actions.js").read_text(encoding="utf-8")
print("==== generateQwenTtsCue")
start = aa.find("export async function generateQwenTtsCue")
print(aa[start:start+900])

print("==== hops / library / unlabeled / import / create")
files = [
    "client/src/components/CharacterAssetsWorkspace.tsx",
    "client/src/components/StoryboardWorkspace.tsx",
    "client/src/components/StoryboardDirection.tsx",
    "client/src/components/AssetActionDrawer.tsx",
    "client/src/contextual-agency/agency-actions.js",
]
keys = ["Library", "onOpenLibrary", "openWorkspace", "/assets", "Import", "Create", "unlabeled", "Untitled", "slot", "hop", "pushState", "Open in"]
for rel in files:
    t = (root / rel).read_text(encoding="utf-8")
    print("--", rel)
    for i, line in enumerate(t.splitlines(), 1):
        if any(k in line for k in keys):
            print(f"{i}:{line[:190]}")
