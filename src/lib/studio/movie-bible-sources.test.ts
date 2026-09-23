import assert from "node:assert/strict";
import test from "node:test";
import { seedResearchBibleFromIntake } from "../research/bible.ts";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay } from "./screenplay.ts";
import { BIBLE_FIELDS, bibleSearchText, bibleSourceReading, editBibleField, movieBibleIndex, pictureBibleFieldView, resolveBibleRecord } from "./movie-bible.ts";
import { DEFAULT_ENGINES, type Picture } from "./types.ts";

function picture(): Picture {
  return {
    id: "picture-1",
    title: "Source test",
    logline: "",
    genre: "",
    tone: "",
    format: "16:9",
    fps: 24,
    runtimeMinutes: 1,
    createdAt: 1,
    updatedAt: 1,
    stage: "intake",
    lastOpenedStage: "intake",
    thumbnailUrl: null,
    intake: makePictureIntake(1),
    screenplay: makePictureScreenplay("single", null, 1),
    selectedEngine: DEFAULT_ENGINES,
    screenplayFountain: "",
    acts: [],
    scenes: [],
    characters: [],
    locations: [],
    props: [],
    wardrobe: [],
    vfx: [],
    shots: [],
    cues: [],
    voices: [],
    directorNotes: "",
    usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
  };
}

test("intake files have stable distinct Bible records with their original full text", () => {
  const p = picture();
  const fullText = `  First paragraph.\r\n\r\n${"Repeated paragraph.\r\n\r\n".repeat(500)}Last paragraph.  `;
  const first = { fileName: "source.md", mediaType: "text/markdown" as const, importedAt: 10, text: fullText };
  const second = { fileName: "source.md", mediaType: "text/markdown" as const, importedAt: 10, text: "A different file." };
  p.intake.importedSources = [first, second];
  const rows = movieBibleIndex(p).filter((row) => row.kind === "source");
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[0].status, "user-supplied file");
  assert.equal(resolveBibleRecord(p, rows[0].id), first);
  assert.deepEqual(bibleSourceReading(p, rows[0]), {
    locator: "source.md",
    text: fullText,
    label: "Imported document",
    importedAt: 10,
  });
  assert.match(bibleSearchText(rows[0], p), /Last paragraph/);
  const originalId = rows[0].id;
  first.text += "\r\nUser annotation.";
  p.intake.importedSources.push({ fileName: "later.fountain", mediaType: "text/fountain", importedAt: 11, text: "Another source." });
  assert.equal(movieBibleIndex(p).find((row) => row.id === originalId)?.id, originalId);
  assert.equal(bibleSourceReading(p, rows[0])?.text, first.text);
});

test("research sources expose the recorded quote and locator without implied approval", () => {
  const p = picture();
  const quote = "  A recorded line.\n\nA recorded line.\n";
  const research = seedResearchBibleFromIntake(p.intake, 2);
  research.content.sources = [{
    id: "research-source-1",
    title: "Luke",
    locator: "Luke 15:11–32",
    quote,
    confidence: "C",
    importedFrom: null,
    createdAt: 2,
  }];
  p.research = research;
  const row = movieBibleIndex(p).find((item) => item.id === "research-source-1");
  assert.ok(row);
  assert.equal(row.kind, "source");
  assert.equal(row.status, "recorded; approval not inferred");
  assert.deepEqual(bibleSourceReading(p, row), {
    locator: "Luke 15:11–32",
    text: quote,
    label: "Source quote / supplied text",
  });
  assert.match(bibleSearchText(row, p), /Luke 15:11–32/);
});

test("film contract reads only explicit intake direction and preserves saved Bible edits", () => {
  const p = picture();
  const fields = BIBLE_FIELDS.picture;
  assert.equal(pictureBibleFieldView(p, fields[0]).disposition, "missing");
  assert.equal(pictureBibleFieldView(p, fields[2]).value, "");
  assert.equal(pictureBibleFieldView(p, fields[6]).value, "");
  p.intake.moralQuestion = "What does mercy cost?";
  p.intake.language = "Aramaic";
  p.intake.deliveryFormat = "MP4";
  p.intake.deliveryCodec = "H.264";
  p.intake.continuityPolicy = "The father keeps his robe.";
  p.intake.voicePolicy = "One voice per character.";
  p.intake.scoreStrategy = "No non-diegetic score.";
  assert.equal(pictureBibleFieldView(p, fields[0]).value, "What does mercy cost?");
  assert.equal(pictureBibleFieldView(p, fields[2]).value, "Aramaic");
  assert.match(pictureBibleFieldView(p, fields[3]).value, /Requested video codec: H\.264/);
  assert.equal(pictureBibleFieldView(p, fields[4]).value, "The father keeps his robe.");
  assert.equal(pictureBibleFieldView(p, fields[5]).value, "One voice per character.");
  assert.equal(pictureBibleFieldView(p, fields[6]).value, "No non-diegetic score.");
  const edited = editBibleField(p, p.id, "picture", fields[0], "Does the older brother enter?", "User correction", "authored", 3);
  assert.equal(edited.records[p.id].fields[fields[0]].value, "Does the older brother enter?");
  assert.equal(p.intake.moralQuestion, "What does mercy cost?");
});
