import test from "node:test";
import assert from "node:assert/strict";
import { visualDirectionText, type VisualDirection } from "./visual-direction.ts";
import { makePictureIntake } from "./picture-intake.ts";
import { buildScreenplayPrompt } from "./screenplay-prompts.ts";

const board: VisualDirection = { sources: [{id: "source1", name: "reference.jpg"}], boardId: "board1", notes: "Warm highlights", guide: "Warm directional light and textured natural fibers.", analyzedBoardId: "board1", analysisModel: "local-vision" };
test("existing pictures without a visual board keep their original behavior", () => assert.equal(visualDirectionText(), ""));
test("visual direction transfers design, never reference identity or scene", () => {
  const text = visualDirectionText(board);
  assert.match(text, /Do not copy any depicted person's identity/);
  assert.match(text, /current screenplay.*control identity/);
  assert.match(text, /neutral grey background/);
  assert.match(text, /Warm directional light/);
});
test("changed or unanalyzed boards cannot silently use an older guide", () => {
  assert.throws(() => visualDirectionText({...board, boardId: "board2"}), /needs analysis/);
  assert.throws(() => visualDirectionText({...board, guide: undefined}), /needs analysis/);
  assert.throws(() => visualDirectionText({...board, analyzedBoardId: undefined}), /needs analysis/);
});
test("screenplay prompt receives analyzed visual design and its reference-only role", () => {
  const result = buildScreenplayPrompt({ intake: { ...makePictureIntake(), visualDirection: board }, workflow: "single", step: { id: "draft", label: "Draft", pass: null, focus: "Story" } });
  assert.match(result.user, /Warm directional light/);
  assert.match(result.user, /Do not copy any depicted person's identity/);
});
