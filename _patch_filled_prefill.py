from pathlib import Path
p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\client\src\components\CharacterAssetsWorkspace.tsx")
t = p.read_text(encoding="utf-8")
old = "  const store = useStore();\n  const project = store.project!;"
new = "  const store = useStore();\n  const project = store.project!;\n  const storyboard = store.storyboard;"
if old not in t:
    raise SystemExit("store block missing")
t = t.replace(old, new, 1)
old = """      initialAction: action || (file ? (asset.approvalCurrent ? \"edit\" : \"review\") : \"upload\"),
      slotState: file ? (asset.approvalCurrent ? \"approved\" : \"unapproved\") : \"planned\",
      returnFocusId: asset.id
    });"""
new = """      initialAction: action || (file ? (asset.approvalCurrent ? \"edit\" : \"review\") : \"upload\"),
      slotState: file ? (asset.approvalCurrent ? \"approved\" : \"unapproved\") : \"planned\",
      returnFocusId: asset.id,
      prefill: biblePrefill(bundle, category, storyboard)
    });"""
if old not in t:
    raise SystemExit("openFilledSlot missing")
t = t.replace(old, new, 1)
p.write_text(t, encoding="utf-8")
print("ok")
