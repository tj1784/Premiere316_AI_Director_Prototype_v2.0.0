from pathlib import Path
p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\tests\contextual-agency.test.mjs")
t = p.read_text(encoding="utf-8")
t = t.replace(
'''  generateQwenTtsCue,
  nextMissingIntent,
  isLtxDialogueCue,
  isVoiceCategory,''',
'''  generateQwenTtsCue,
  nextMissingIntent,
  isLtxDialogueCue,
  isVoiceCategory,
  cueLinesForCharacter,
  locksFromBundle,
  withContinuityLocks,'''
)
t = t.replace(
    '  }, { voiceName: "David" }, fetchImpl);',
    '  }, { voiceName: "David", cueLines: ["Father, into your hands."] }, fetchImpl);'
)
t += '''

test("CHR-008 empty voice offers character cue lines, not enrollment", () => {
  const lines = cueLinesForCharacter("David", {
    clips: { "H04-S13-C03": { speaker: "David", dialogueAnchor: "Father, into your hands." } },
    segments: { "seg-1": { speaker: "David", dialogueAnchor: "It is finished." }, "seg-2": { speaker: "Voice of Hell", dialogueAnchor: "The hour has come." } }
  });
  assert.deepEqual(lines, ["Father, into your hands.", "It is finished."]);
  assert.equal(lines.includes("The hour has come."), false);
});

test("CHR-006 generate-from-character keeps bible continuity locks", async () => {
  const store = mockStore();
  store.generateAsset = async (id) => { store.calls.push(["generateAsset", id]); };
  const locks = ["iron collar locked", "wrists bound"];
  assert.match(withContinuityLocks("David sheet", locks), /CONTINUITY LOCKS/);
  assert.deepEqual(locksFromBundle({ primaryAsset: { continuity: locks } }), locks);
  await generateForIntent(store, {
    sourceEntity: { type: "character", id: "character-david", label: "David" },
    requirement: { relationship: "character.primaryAppearance", category: "character" },
    prefill: { name: "David", prompt: "Production identity sheet for David.", continuity: locks, continuityLocks: locks }
  }, { prompt: "Production identity sheet for David.", continuity: locks, attachAfter: false });
  const patch = store.calls.find((call) => call[0] === "patchAsset");
  assert.ok(patch);
  assert.deepEqual(patch[2].continuity, locks);
  assert.match(patch[2].prompt, /iron collar locked/);
});
'''
p.write_text(t, encoding="utf-8")
print("tests ok")
