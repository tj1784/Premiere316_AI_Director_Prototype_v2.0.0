from pathlib import Path
root = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0")

sd = root / "client" / "src" / "components" / "StoryboardDirection.tsx"
s = sd.read_text(encoding="utf-8")

if "export function openLtxDirector" not in s:
    s = s.replace(
        'import { openAssetAction } from "../contextual-agency";',
        '''import { openAssetAction } from "../contextual-agency";

export function openLtxDirector(store: any, clipId: string) {
  if (clipId && store?.setSelectedStoryboardClip) store.setSelectedStoryboardClip(clipId);
  const params = new URLSearchParams(window.location.search);
  if (store?.project?.slug) params.set("project", store.project.slug);
  window.history.pushState({}, "", `/direct/ltx${params.size ? `?${params}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}'''
    )

if "fullPrompt" not in s:
    s = s.replace(
        "  const [expandedPrompt, setExpandedPrompt] = useState(false);\n  const persistedStart",
        "  const [expandedPrompt, setExpandedPrompt] = useState(false);\n  const [fullPrompt, setFullPrompt] = useState(false);\n  const persistedStart",
    )
    s = s.replace(
        '{expandedPrompt ? "Collapse" : "Expand"}</button>',
        '{expandedPrompt ? "Collapse" : "Expand"}</button>\n        <button type="button" className="storyboard-copy-button" onClick={() => setFullPrompt(true)}>Full preview</button>',
    )
    old_footer = '''        <button type="button" className="storyboard-copy-button" disabled={busy} onClick={() => void store.mutateStoryboardStructure({ action: "move", clipId, segmentId: segment.id, toIndex: Number(segment.order || 1) })}>Move down</button>
      </footer>
    </div>'''
    new_footer = '''        <button type="button" className="storyboard-copy-button" disabled={busy} onClick={() => void store.mutateStoryboardStructure({ action: "move", clipId, segmentId: segment.id, toIndex: Number(segment.order || 1) })}>Move down</button>
        <button type="button" className="storyboard-copy-button" onClick={() => openLtxDirector(store, clipId)}>Open in LTX Director</button>
      </footer>
      {fullPrompt ? (
        <div className="storyboard-prompt-fullscreen" role="dialog" aria-modal="true" aria-label="Segment prompt full preview">
          <header>
            <div>
              <p className="eyebrow">SEGMENT PROMPT</p>
              <h2>{clipLabel} · segment {segment.order}</h2>
            </div>
            <div className="requirement-slot-actions">
              <button type="button" className="storyboard-copy-button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save segment"}</button>
              <button type="button" className="storyboard-copy-button" onClick={() => setFullPrompt(false)}>Close</button>
            </div>
          </header>
          <textarea aria-label="Full-screen segment prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </div>
      ) : null}
    </div>'''
    if old_footer not in s:
        raise SystemExit("footer block not found")
    s = s.replace(old_footer, new_footer)

sd.write_text(s, encoding="utf-8")
print("direction ok")

sw = root / "client" / "src" / "components" / "StoryboardWorkspace.tsx"
w = sw.read_text(encoding="utf-8")
if "openLtxDirector" not in w:
    w = w.replace(
        'import { AudioOffChip, ClipDirectionEditor, SegmentDirectionEditor } from "./StoryboardDirection";',
        'import { AudioOffChip, ClipDirectionEditor, SegmentDirectionEditor, openLtxDirector } from "./StoryboardDirection";',
    )
old_ltx = """  const goDirectLtx = (clipId: string) => {
    store.setSelectedStoryboardClip(clipId);
    const params = new URLSearchParams(window.location.search);
    if (project?.slug) params.set("project", project.slug);
    window.history.pushState({}, "", `/direct/ltx${params.size ? `?${params}` : ""}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };"""
if old_ltx in w:
    w = w.replace(old_ltx, "  const goDirectLtx = (clipId: string) => openLtxDirector(store, clipId);")
if 'label="Copy local prompt" /></header>' in w:
    w = w.replace(
        '<CopyButton text={segment.prompt} label="Copy local prompt" /></header>',
        '<CopyButton text={segment.prompt} label="Copy local prompt" /><button type="button" className="storyboard-copy-button" onClick={() => goDirectLtx(clip.id)}>Open in LTX Director</button></header>',
    )
old_missing = "                          const missing = [firstFrame, ...segments.map((segment: any) => segment.frameId ? storyboard.frames?.[segment.frameId] : null)].filter((frame: any) => frame && frame.id && !frameFile(frame) && frame.status !== 'generated');"
if old_missing in w:
    w = w.replace(
        old_missing,
        '                          const missing = [firstFrame].filter((frame: any) => frame && frame.id && !frameFile(frame) && frame.status !== "generated");',
    )
sw.write_text(w, encoding="utf-8")
print("workspace ok")

dw = root / "client" / "src" / "components" / "AssetActionDrawer.tsx"
d = dw.read_text(encoding="utf-8")
if "nextMissingIntent" not in d:
    d = d.replace(
        "  restoreForIntent,\n  previousVersion,",
        "  restoreForIntent,\n  previousVersion,\n  nextMissingIntent,",
    )
    if 'import { resultActions, useAssetActionStore, type AssetActionName } from "../contextual-agency";' in d:
        d = d.replace(
            'import { resultActions, useAssetActionStore, type AssetActionName } from "../contextual-agency";',
            'import { openAssetAction, resultActions, useAssetActionStore, type AssetActionName } from "../contextual-agency";',
        )
    elif "openAssetAction" not in d.split("from")[0]:
        d = d.replace(
            'import { resultActions, useAssetActionStore, type AssetActionName } from "../contextual-agency";',
            'import { openAssetAction, resultActions, useAssetActionStore, type AssetActionName } from "../contextual-agency";',
        )
    old_follow = '''                    if (action.kind === "attach") { setMode("attach"); void onAttach(); }
                    else if (action.kind === "review") setMode("review");
                    else if (action.kind === "versions") setMode("versions");'''
    new_follow = '''                    if (action.kind === "attach") { setMode("attach"); void onAttach(); }
                    else if (action.kind === "review") setMode("review");
                    else if (action.kind === "versions") setMode("versions");
                    else if (action.kind === "continue") {
                      const next = nextMissingIntent(store, intent);
                      if (next) openAssetAction(next);
                      else close();
                    }'''
    if old_follow not in d:
        raise SystemExit("follow-up block not found")
    d = d.replace(old_follow, new_follow)
    d = d.replace(
        'intent.sourceEntity.type === "guide" ? "Pins this file as the LTX first temporal guide for the selected segment." : intent.sourceEntity.type === "character" ? "Writes the character relationship onto the result." : "Pins this asset as a Storyboard semantic reference."',
        'intent.sourceEntity.type === "guide" ? "Pins this file as the LTX first temporal guide for the selected segment." : intent.sourceEntity.type === "character" ? "Writes the character relationship onto the result." : intent.requirement.relationship === "segment.dialogueAudio" ? "Pins this take to the segment dialogue slot. Not a visual reference." : "Pins this asset as a Storyboard semantic reference."',
    )
dw.write_text(d, encoding="utf-8")
print("drawer ok")

aa = root / "client" / "src" / "contextual-agency" / "agency-actions.js"
a = aa.read_text(encoding="utf-8")
if "export function nextMissingIntent" not in a:
    a += """

export function nextMissingIntent(store, intent) {
  if (!intent || intent.sourceEntity?.type !== "character") return null;
  const items = store?.project?.assets?.items || [];
  const characterId = intent.sourceEntity.id;
  const related = items.filter((item) => item.id === characterId || (item.dependencies || []).includes(characterId));
  const hasWardrobe = related.some((item) => item.category === "wardrobe");
  const hasVoice = related.some((item) => item.category === "voice");
  if (!hasWardrobe && intent.requirement?.relationship !== "character.wardrobe") {
    return {
      ...intent,
      requirement: { relationship: "character.wardrobe", category: "wardrobe", expectedMediaType: "image" },
      initialAction: "generate",
      slotState: "missing"
    };
  }
  if (!hasVoice && intent.requirement?.relationship !== "character.voice") {
    return {
      ...intent,
      requirement: { relationship: "character.voice", category: "voice", expectedMediaType: "audio" },
      initialAction: "create",
      slotState: "missing"
    };
  }
  return null;
}
"""
    aa.write_text(a, encoding="utf-8")
    print("nextMissing ok")

idx = root / "client" / "src" / "contextual-agency" / "index.ts"
ix = idx.read_text(encoding="utf-8")
if "nextMissingIntent" not in ix:
    ix = ix.replace(
        "  restoreForIntent,\n  previousVersion,",
        "  restoreForIntent,\n  previousVersion,\n  nextMissingIntent,",
    )
    idx.write_text(ix, encoding="utf-8")
    print("index export")

css = root / "client" / "src" / "styles.css"
c = css.read_text(encoding="utf-8")
if "storyboard-prompt-fullscreen" not in c:
    css.write_text(
        c.rstrip()
        + """
.storyboard-prompt-fullscreen { position: fixed; inset: 0; z-index: 140; display: grid; grid-template-rows: auto 1fr; background: #0b111a; padding: 18px 22px; }
.storyboard-prompt-fullscreen header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 12px; }
.storyboard-prompt-fullscreen h2 { margin: 0; color: #f1f5fb; font-size: 20px; }
.storyboard-prompt-fullscreen textarea { width: 100%; height: 100%; min-height: 0; resize: none; padding: 16px; font: inherit; line-height: 1.45; }
""",
        encoding="utf-8",
    )
    print("css ok")

print("ALL DONE")
