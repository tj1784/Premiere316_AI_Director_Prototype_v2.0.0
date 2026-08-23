from pathlib import Path
root = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0")

# types
p = root / "client/src/contextual-agency/types.ts"
t = p.read_text(encoding="utf-8")
old = "  prefill?: { name?: string; prompt?: string; sampleText?: string };"
new = "  prefill?: { name?: string; prompt?: string; sampleText?: string; continuity?: string[]; continuityLocks?: string[]; cueLines?: string[] };"
if old not in t:
    raise SystemExit("types prefill missing")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("types ok")

# CharacterAssetsWorkspace
p = root / "client/src/components/CharacterAssetsWorkspace.tsx"
t = p.read_text(encoding="utf-8")
if "from \"../contextual-agency/agency-actions.js\"" not in t and "cueLinesForCharacter" not in t:
    t = t.replace(
        "import { openAssetAction } from \"../contextual-agency\";",
        "import { openAssetAction } from \"../contextual-agency\";\nimport { cueLinesForCharacter, locksFromBundle } from \"../contextual-agency/agency-actions.js\";"
    )
    if "cueLinesForCharacter" not in t:
        # try other import style
        if "from \"../contextual-agency\"" in t and "cueLinesForCharacter" not in t:
            t = t.replace(
                "from \"../contextual-agency\";",
                "from \"../contextual-agency\";\nimport { cueLinesForCharacter, locksFromBundle } from \"../contextual-agency/agency-actions.js\";"
            )

old = '''function biblePrefill(bundle: any, category: "character" | "wardrobe" | "voice") {
  const name = readableCharacterText(bundle.name);
  const sheetPrompt = String(bundle.primaryAsset?.prompt || bundle.characterAssets?.[0]?.prompt || "").trim();
  if (category === "wardrobe") {
    return { name, prompt: `Wardrobe continuity for ${name}. Keep identity locked to the approved character sheet. ${sheetPrompt}`.trim() };
  }
  if (category === "voice") {
    return { name, prompt: `Stable cinematic voice identity for ${name}.`, sampleText: "The hour has come." };
  }
  return { name, prompt: sheetPrompt || `Production identity sheet for ${name}.` };
}

function openMissingSlot(bundle: any) {'''
new = '''function biblePrefill(bundle: any, category: "character" | "wardrobe" | "voice", storyboard?: any) {
  const name = readableCharacterText(bundle.name);
  const sheetPrompt = String(bundle.primaryAsset?.prompt || bundle.characterAssets?.[0]?.prompt || "").trim();
  const continuity = locksFromBundle(bundle);
  const cueLines = cueLinesForCharacter(name, storyboard);
  if (category === "wardrobe") {
    return { name, prompt: `Wardrobe continuity for ${name}. Keep identity locked to the approved character sheet. ${sheetPrompt}`.trim(), continuity, continuityLocks: continuity };
  }
  if (category === "voice") {
    return { name, prompt: `Stable cinematic voice identity for ${name}.`, sampleText: cueLines[0] || "", cueLines, continuity, continuityLocks: continuity };
  }
  return { name, prompt: sheetPrompt || `Production identity sheet for ${name}.`, continuity, continuityLocks: continuity };
}

function openMissingSlot(bundle: any, storyboard?: any) {'''
if old not in t:
    raise SystemExit("biblePrefill block missing")
t = t.replace(old, new, 1)
t = t.replace('prefill: biblePrefill(bundle, "wardrobe")', 'prefill: biblePrefill(bundle, "wardrobe", storyboard)')
t = t.replace('prefill: biblePrefill(bundle, "voice")', 'prefill: biblePrefill(bundle, "voice", storyboard)')
t = t.replace('prefill: biblePrefill(bundle, "character")', 'prefill: biblePrefill(bundle, "character", storyboard)')
t = t.replace("openMissingSlot(first);", "openMissingSlot(first, store.storyboard);")
t = t.replace("onClick={() => openMissingSlot(bundle)}", "onClick={() => openMissingSlot(bundle, store.storyboard)}")
p.write_text(t, encoding="utf-8")
print("bible ok")

# Drawer
p = root / "client/src/components/AssetActionDrawer.tsx"
t = p.read_text(encoding="utf-8")
if "withContinuityLocks" not in t:
    t = t.replace(
        "  sessionFromVoiceDesign\n} from \"../contextual-agency/agency-actions.js\";",
        "  sessionFromVoiceDesign,\n  withContinuityLocks\n} from \"../contextual-agency/agency-actions.js\";"
    )
old = '''    const cueLine = String(intent.prefill?.sampleText || intent.prefill?.prompt || "").trim();
    const fromCue = intent.requirement.category === "dialogue" || String(intent.requirement.relationship || "").includes("dialogue") || String(intent.requirement.relationship || "").includes("cue");
    setAuditionText(fromCue ? (cueLine || "") : (workingAsset?.sampleText || cueLine || "The hour has come."));'''
new = '''    const cueLines = Array.isArray(intent.prefill?.cueLines) ? intent.prefill.cueLines.map((item: string) => String(item || "").trim()).filter(Boolean) : [];
    const cueLine = String(intent.prefill?.sampleText || "").trim() || cueLines[0] || "";
    const fromCue = intent.requirement.category === "dialogue" || String(intent.requirement.relationship || "").includes("dialogue") || String(intent.requirement.relationship || "").includes("cue");
    const voiceEmpty = intent.requirement.category === "voice";
    setAuditionText(fromCue || voiceEmpty ? (cueLine || "") : (workingAsset?.sampleText || cueLine || ""));
    const locks = intent.prefill?.continuity || intent.prefill?.continuityLocks || workingAsset?.continuity || [];
    if (Array.isArray(locks) && locks.length) {
      setPrompt((current) => {
        const base = workingAsset?.prompt || intent.prefill?.prompt || current || "";
        return withContinuityLocks(base, locks);
      });
    }'''
if old not in t:
    raise SystemExit("drawer audition block missing")
t = t.replace(old, new, 1)

# onGenerate pass continuity and cueLines
old = '''    const result = await generateForIntent(store, intent, {
      name: name.trim(),
      variant,
      prompt,
      instruct: prompt,
      voiceName: name.trim() || intent.sourceEntity.label,
      auditionText,
      sampleText: auditionText,
      asset: workingAsset
    });'''
new = '''    const result = await generateForIntent(store, intent, {
      name: name.trim(),
      variant,
      prompt,
      instruct: prompt,
      voiceName: name.trim() || intent.sourceEntity.label,
      auditionText,
      sampleText: auditionText,
      cueLines: intent.prefill?.cueLines,
      continuity: intent.prefill?.continuity || intent.prefill?.continuityLocks,
      asset: workingAsset
    });'''
if old not in t:
    raise SystemExit("onGenerate fields missing")
t = t.replace(old, new, 1)

old = '''              {voiceMode ? <label>Audition line<textarea rows={3} value={auditionText} onChange={(event) => setAuditionText(event.target.value)} /></label> : null}'''
new = '''              {voiceMode ? <label>Audition line<textarea rows={3} value={auditionText} onChange={(event) => setAuditionText(event.target.value)} placeholder="Use a cue line for this character" /></label> : null}
              {voiceMode && Array.isArray(intent.prefill?.cueLines) && intent.prefill.cueLines.length ? (
                <div className="requirement-slot-actions" aria-label="Character cue lines">
                  {intent.prefill.cueLines.map((line: string) => (
                    <button key={line} type="button" className="button secondary" onClick={() => setAuditionText(line)}>{line}</button>
                  ))}
                </div>
              ) : null}'''
if old not in t:
    raise SystemExit("audition label missing")
t = t.replace(old, new, 1)
p.write_text(t, encoding="utf-8")
print("drawer ok")
print("done")
