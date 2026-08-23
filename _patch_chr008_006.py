from pathlib import Path
root = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0")

# --- agency-actions.js ---
p = root / "client/src/contextual-agency/agency-actions.js"
t = p.read_text(encoding="utf-8")
needle = "export async function createPlannedAsset(store, intent, fields = {}) {"
insert = """
export function cueLinesForCharacter(name, storyboard) {
  const needle = String(name || "").toLowerCase().trim();
  const lines = [];
  const push = (text, speaker) => {
    const spoken = String(text || "").trim();
    if (!spoken) return;
    const who = String(speaker || "").toLowerCase();
    if (needle && who && !who.includes(needle) && !needle.includes(who)) return;
    if (!lines.includes(spoken)) lines.push(spoken);
  };
  const clips = storyboard?.clips;
  const clipList = Array.isArray(clips) ? clips : Object.values(clips || {});
  for (const clip of clipList) {
    const speaker = clip?.speaker || clip?.dialogueSpeaker || clip?.character;
    push(clip?.dialogueAnchor, speaker);
    for (const segment of clip?.segments || []) push(segment?.dialogueAnchor, segment?.speaker || speaker);
  }
  const segments = storyboard?.segments;
  const segmentList = Array.isArray(segments) ? segments : Object.values(segments || {});
  for (const segment of segmentList) {
    push(segment?.dialogueAnchor, segment?.speaker || segment?.dialogueSpeaker || segment?.character);
  }
  return lines;
}

export function locksFromBundle(bundle) {
  const out = [];
  for (const asset of [bundle?.primaryAsset, ...(bundle?.characterAssets || []), ...(bundle?.wardrobeAssets || []), ...(bundle?.voiceAssets || [])]) {
    for (const lock of asset?.continuity || asset?.continuityLocks || []) {
      const text = String(lock || "").trim();
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

export function withContinuityLocks(prompt, locks) {
  const list = Array.isArray(locks) ? locks.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const base = String(prompt || "").trim();
  if (!list.length) return base;
  if (/CONTINUITY LOCKS/i.test(base)) return base;
  return `${base}\\n\\nCONTINUITY LOCKS\\n- ${list.join("\\n- ")}`.trim();
}

"""
# fix the double-escaped newlines in template - we want JS template with real \n
insert = insert.replace("\\\\n", "\\n")
if "export function cueLinesForCharacter" not in t:
    if needle not in t:
        raise SystemExit("createPlannedAsset missing")
    t = t.replace(needle, insert + needle)

old = """    prompt: fields.prompt || \"\",
    sampleText: fields.sampleText,
    dependencies: withCharacterDependency([], characterId)"""
new = """    prompt: fields.prompt || \"\",
    sampleText: fields.sampleText,
    continuity: fields.continuity || fields.continuityLocks || intent.prefill?.continuity || intent.prefill?.continuityLocks || [],
    dependencies: withCharacterDependency([], characterId)"""
if old not in t:
    raise SystemExit("createPlannedAsset fields missing")
t = t.replace(old, new, 1)

t = t.replace(
    'const auditionText = String(fields.auditionText || fields.sampleText || "The hour has come.").trim();',
    'const auditionText = String(fields.auditionText || fields.sampleText || (fields.cueLines || [])[0] || "").trim();\n  if (!auditionText) throw new Error("This character has no cue line to audition. Offer a storyboard cue, not Voice Design enrollment.");',
)

oldg = """  let asset = fields.asset;
  if (!asset) asset = await createPlannedAsset(store, intent, fields);
  await store.generateAsset(asset.id);"""
newg = """  let asset = fields.asset;
  if (!asset) asset = await createPlannedAsset(store, intent, fields);
  const locks = fields.continuity || fields.continuityLocks || intent.prefill?.continuity || intent.prefill?.continuityLocks || asset.continuity || [];
  const lockedPrompt = withContinuityLocks(fields.prompt || asset.prompt, locks);
  if (typeof store.patchAsset === "function" && (locks.length || lockedPrompt !== String(asset.prompt || ""))) {
    await store.patchAsset(asset.id, { prompt: lockedPrompt, continuity: locks });
    asset = { ...asset, prompt: lockedPrompt, continuity: locks };
  }
  await store.generateAsset(asset.id);"""
if oldg not in t:
    raise SystemExit("generateForIntent block missing")
t = t.replace(oldg, newg, 1)
p.write_text(t, encoding="utf-8")
print("agency-actions ok")
