import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { bibleSourceReading, movieBibleIndex, resolveBibleRecord } from "./movie-bible.ts";
import { importedSourceRecords } from "./imported-source-records.ts";
import { makeProdigalSonPicture } from "./prodigal-son.ts";

test("the Prodigal package manifest is discoverable without inventing available files", () => {
  const picture = makeProdigalSonPicture();
  const source = importedSourceRecords(picture);
  const indexed = movieBibleIndex(picture).filter((row) => row.id.startsWith("package-source:"));
  assert.equal(source.length, Object.keys(picture.importedPackage!.sourceSha256).length);
  assert.equal(indexed.length, source.length);
  assert.equal(new Set(indexed.map((row) => row.id)).size, source.length);

  const notes = source.find((item) => item.fileName === "Research_and_Adaptation_Notes.md")!;
  const notesRow = indexed.find((row) => row.id === notes.id)!;
  assert.equal(bibleSourceReading(picture, notesRow)?.text, picture.importedPackage!.researchNotes);
  assert.deepEqual(resolveBibleRecord(picture, notes.id), notes);

  const manifestOnly = source.find((item) => item.fileName === "inventory_summary.json")!;
  assert.equal(manifestOnly.href, null);
  assert.equal(indexed.find((row) => row.id === manifestOnly.id)?.status, "source manifest entry");
});

test("each present linked Prodigal source has the exact recorded bytes", (context) => {
  const picture = makeProdigalSonPicture();
  const linked = importedSourceRecords(picture).filter((item) => item.href);
  const publicRoot = process.env.PREMIERE316_PUBLIC_DIR ?? "public";
  const present = linked.filter((source) => {
    const uri = new URL(source.href!, "http://localhost");
    return existsSync(`${publicRoot}${decodeURIComponent(uri.pathname)}`);
  });
  if (!present.length) return context.skip("Original files are omitted by this sparse checkout.");
  assert.equal(present.length, linked.length, "Only some linked source files are present.");
  for (const source of present) {
    const uri = new URL(source.href!, "http://localhost");
    assert.equal(uri.origin, "http://localhost");
    const bytes = readFileSync(`${publicRoot}${decodeURIComponent(uri.pathname)}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.fileName);
  }
});
