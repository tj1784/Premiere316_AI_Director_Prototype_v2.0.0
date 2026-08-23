from pathlib import Path
root = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0")

sw = root / "client/src/components/StoryboardWorkspace.tsx"
w = sw.read_text(encoding="utf-8")
old = """              onGenerateAll={() => {
                const frameFile = (frame: any) => frame?.generatedFile || frame?.generatedVersions?.find((version: any) => Number(version.v) === Number(frame?.activeGeneratedVersion))?.file;
                const missing = [firstFrame, ...segments.map((segment: any) => segment.frameId ? storyboard.frames?.[segment.frameId] : null)].filter((frame: any) => frame && frame.id && !frameFile(frame) && frame.status !== "generated");
                for (const frame of missing) void store.generateStoryboardFrame(frame.id);
              }}"""
# the existing file may still have single-quoted generated
old2 = old.replace('!== "generated"', "!== 'generated'")
new = """              onGenerateAll={() => {
                const frameFile = (frame: any) => frame?.generatedFile || frame?.generatedVersions?.find((version: any) => Number(version.v) === Number(frame?.activeGeneratedVersion))?.file;
                const missing = [firstFrame].filter((frame: any) => frame && frame.id && !frameFile(frame) && frame.status !== "generated");
                for (const frame of missing) void store.generateStoryboardFrame(frame.id);
              }}"""
if old in w:
    w = w.replace(old, new)
    print("fixed firstFrame generate-all double-quoted")
elif old2 in w:
    w = w.replace(old2, new)
    print("fixed firstFrame generate-all single-quoted")
else:
    print("firstFrame generate-all pattern not found")
    for i, line in enumerate(w.splitlines(), 1):
        if "const missing" in line:
            print(f"  {i}:{line[:200]}")
sw.write_text(w, encoding="utf-8")

sd = root / "client/src/components/StoryboardDirection.tsx"
s = sd.read_text(encoding="utf-8")
# clip editor: drop unused expandedPrompt, add Open in LTX
if "setExpandedPrompt" in s and "ClipDirectionEditor" in s:
    s = s.replace(
        "  const [notice, setNotice] = useState(\"\");\n  const [expandedPrompt, setExpandedPrompt] = useState(false);\n  const dirty = dialogue !== String(clip.dialogueAnchor || \"\")",
        "  const [notice, setNotice] = useState(\"\");\n  const dirty = dialogue !== String(clip.dialogueAnchor || \"\")",
    )
if 'Add segment</button>\n      </footer>\n    </section>' in s and "openLtxDirector(store, clip.id)" not in s:
    s = s.replace(
        '        <button type="button" className="storyboard-copy-button" disabled={busy} onClick={() => void store.mutateStoryboardStructure({ action: "add", clipId: clip.id })}>Add segment</button>\n      </footer>',
        '        <button type="button" className="storyboard-copy-button" disabled={busy} onClick={() => void store.mutateStoryboardStructure({ action: "add", clipId: clip.id })}>Add segment</button>\n        <button type="button" className="storyboard-copy-button" onClick={() => openLtxDirector(store, clip.id)}>Open in LTX Director</button>\n      </footer>',
    )
    print("clip editor LTX")
sd.write_text(s, encoding="utf-8")

# test
testp = root / "tests/contextual-agency.test.mjs"
t = testp.read_text(encoding="utf-8")
if "nextMissingIntent" not in t:
    t = t.replace(
        "  generateQwenTtsCue,\n  isVoiceCategory,",
        "  generateQwenTtsCue,\n  nextMissingIntent,\n  isVoiceCategory,",
    )
    t += """

test("drawer continue-missing opens the next character hole", () => {
  const store = mockStore({
    project: {
      slug: "harrowing",
      assets: { items: [{ id: "adam", category: "character", name: "Adam" }] }
    }
  });
  const next = nextMissingIntent(store, {
    sourceRoute: "/assets/characters",
    sourceEntity: { type: "character", id: "adam", label: "Adam" },
    requirement: { relationship: "character.sheet", category: "character", expectedMediaType: "image" },
    initialAction: "generate"
  });
  assert.equal(next.requirement.relationship, "character.wardrobe");
  const afterWardrobe = nextMissingIntent({
    ...store,
    project: {
      slug: "harrowing",
      assets: { items: [
        { id: "adam", category: "character", name: "Adam" },
        { id: "adam-wardrobe", category: "wardrobe", dependencies: ["adam"] }
      ] }
    }
  }, next);
  assert.equal(afterWardrobe.requirement.relationship, "character.voice");
  assert.equal(afterWardrobe.initialAction, "create");
});
"""
    testp.write_text(t, encoding="utf-8")
    print("test added")
else:
    print("test already present")

print("finish patch done")
