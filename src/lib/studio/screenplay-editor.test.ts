import test from "node:test";
import assert from "node:assert/strict";
import { parseScreenplayHierarchy } from "./screenplay-hierarchy.ts";
import { replaceScreenplayEditorScene, textareaOffsetToSource } from "./screenplay-editor.ts";

test("manual scene editing retains imported title, protected dialogue, transitions and other scenes byte for byte", () => {
  const source =
    "Title: THE CROSSING\r\n\r\nEXT. ROAD - DAY #FIRST#\r\n\r\nHe waits.\r\n\r\nCUT TO:\r\n\r\nINT. ROOM - NIGHT #SECOND#\r\n\r\nANA\r\nKeep these words—exactly.\r\n\r\n# End note\r\n";
  const hierarchy = parseScreenplayHierarchy(source);
  const first = hierarchy.nodes.find((n) => n.id === "FIRST")!;
  // Browser textareas normalize imported line endings in the displayed scene only.
  const editedScene = first.fountain.replaceAll("\r\n", "\n").replace("He waits.", "He walks. 🕯️");
  const result = replaceScreenplayEditorScene(source, first, editedScene);
  assert.equal(result, source.replace("He waits.", "He walks. 🕯️"));
  assert.equal(result.slice(0, first.sourceStart), source.slice(0, first.sourceStart));
  assert.equal(
    result.slice(first.sourceEnd + "He walks. 🕯️".length - "He waits.".length),
    source.slice(first.sourceEnd),
  );
  assert.ok(result.includes("ANA\r\nKeep these words—exactly."));
  assert.deepEqual(
    parseScreenplayHierarchy(result, hierarchy)
      .nodes.filter((n) => n.kind === "scene" && !n.tombstoned)
      .map((n) => n.id),
    ["FIRST", "SECOND"],
  );
});
test("selected dialogue offsets match CRLF source, including unicode before the selection", () => {
  const source = "EXT. ROAD\r\n\r\nA 🕯️ burns.\r\nANA\r\nExact words.";
  const displayed = source.replaceAll("\r\n", "\n");
  const start = textareaOffsetToSource(source, displayed.indexOf("Exact"));
  const end = textareaOffsetToSource(source, displayed.length);
  assert.equal(source.slice(start, end), "Exact words.");
});
test("invalid or stale scene boundaries fail without replacing unrelated text", () => {
  assert.throws(() =>
    replaceScreenplayEditorScene("saved", { sourceStart: 0, sourceEnd: 99 }, "replacement"),
  );
  assert.throws(() =>
    replaceScreenplayEditorScene("saved", { sourceStart: -1, sourceEnd: 2 }, "replacement"),
  );
});

test("incidental textarea newline normalization does not rewrite saved source", () => {
  const source = "INT. ROOM\r\n\r\nANA\r\nKeep me.\n\nShe waits.\r\n";
  assert.equal(
    replaceScreenplayEditorScene(
      source,
      { sourceStart: 0, sourceEnd: source.length },
      source.replaceAll("\r\n", "\n"),
    ),
    source,
  );
  assert.equal(
    replaceScreenplayEditorScene(
      source,
      { sourceStart: 0, sourceEnd: source.length },
      source.replaceAll("\r\n", "\n").replace("She waits.", "She turns."),
    ),
    source.replace("She waits.", "She turns."),
  );
});
