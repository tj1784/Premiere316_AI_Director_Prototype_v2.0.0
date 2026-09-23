import assert from "node:assert/strict";
import test from "node:test";
import { emptyResearchContent, makeEmptyResearchBible, type ResearchSource } from "./bible.ts";
import { classifyResearchSource, disputesForSources, harmonizeDispute, recordResearchDispute, recordedResearchDisputes, resolveResearchDispute, unverifiedResearchDisputeNotes } from "./source-ledger.ts";

const source = (id: string, quote: string, locator = `Book ${id}`): ResearchSource => ({
  id, title: `Source ${id}`, locator, quote, confidence: "A", importedFrom: null, createdAt: 1,
});

test("two concordant class A sources do not invent a dispute; legacy count-based rows are ignored", () => {
  const sources = [source("one", "The town met the traveler."), source("two", "The town met the traveler.")];
  const legacy = { id: "dispute:class-a:one+two", sourceIds: ["one", "two"], claim: "Multiple class A claims are present and must be harmonized without deleting sources.", createdAt: 2 };
  assert.deepEqual(disputesForSources(sources, [], 3), []);
  assert.deepEqual(disputesForSources(sources, [legacy], 3), []);
  assert.deepEqual(recordedResearchDisputes({ ...emptyResearchContent(), sources, disputes: [legacy] }), []);
  const priorManualNote = { id: "manual:older", sourceIds: ["one", "two"], claim: "Earlier user note needing citations", createdAt: 2 };
  assert.deepEqual(unverifiedResearchDisputeNotes({ ...emptyResearchContent(), sources, disputes: [legacy, priorManualNote] }), [priorManualNote]);
});

test("a specific conflict requires distinct sources and exact, different quoted evidence", () => {
  const longText = "Source prologue.\n\n" + "Unrelated context. ".repeat(300) + "\nThe gate remained closed.\nClosing note.";
  const content = { ...emptyResearchContent(), sources: [source("one", longText), source("two", "The gate stood open. Further context.")] };
  const valid = { claim: "Whether the gate opened", sourceAId: "one", sourceAExcerpt: "The gate remained closed.", sourceBId: "two", sourceBExcerpt: "The gate stood open." };
  assert.match((recordResearchDispute(content, { ...valid, sourceBId: "one" }, 4) as { error: string }).error, /two different sources/);
  assert.match((recordResearchDispute(content, { ...valid, sourceAExcerpt: "A gate that is not in the text" }, 4) as { error: string }).error, /must occur/);
  assert.match((recordResearchDispute(content, { ...valid, sourceBExcerpt: valid.sourceAExcerpt }, 4) as { error: string }).error, /different evidence/);
  const recorded = recordResearchDispute(content, valid, 4);
  if ("error" in recorded) throw new Error(recorded.error);
  assert.equal(recorded.content.sources[0].quote, longText);
  const dispute = recordedResearchDisputes(recorded.content)[0];
  assert.equal(dispute.claim, valid.claim);
  assert.deepEqual(dispute.sourceIds, ["one", "two"]);
  assert.deepEqual(dispute.evidence.map((item) => item.excerpt), [valid.sourceAExcerpt, valid.sourceBExcerpt]);
  assert.match((recordResearchDispute(recorded.content, valid, 5) as { error: string }).error, /already recorded/);
});

test("resolution is scoped to its evidenced claim, preserves both full sources and leaves unrelated notes untouched", () => {
  const first = source("first", "The wall was finished. The road was flooded.");
  const second = source("second", "The wall was unfinished. The road was dry.");
  const initial = { ...emptyResearchContent(), sources: [first, second], notes: "Independent director notes" };
  const wall = recordResearchDispute(initial, { claim: "Wall completion", sourceAId: "first", sourceAExcerpt: "The wall was finished.", sourceBId: "second", sourceBExcerpt: "The wall was unfinished." }, 10);
  if ("error" in wall) throw new Error(wall.error);
  const road = recordResearchDispute(wall.content, { claim: "Road condition", sourceAId: "first", sourceAExcerpt: "The road was flooded.", sourceBId: "second", sourceBExcerpt: "The road was dry." }, 11);
  if ("error" in road) throw new Error(road.error);
  const wallId = recordedResearchDisputes(road.content)[0].id;
  const roadId = recordedResearchDisputes(road.content)[1].id;
  assert.match((resolveResearchDispute(road.content, wallId, "  ", 12) as { error: string }).error, /Record how/);
  assert.match((resolveResearchDispute(road.content, "nonexistent", "Keep both versions", 12) as { error: string }).error, /No evidenced/);
  const resolved = resolveResearchDispute(road.content, wallId, "The finished wall belongs to a later period.", 12);
  if ("error" in resolved) throw new Error(resolved.error);
  assert.equal(recordedResearchDisputes(resolved.content)[0].resolution?.note, "The finished wall belongs to a later period.");
  assert.equal(recordedResearchDisputes(resolved.content)[1].id, roadId);
  assert.equal(recordedResearchDisputes(resolved.content)[1].resolution, undefined);
  assert.deepEqual(resolved.content.sources, [first, second]);
  assert.equal(resolved.content.notes, initial.notes);
  const bible = { ...makeEmptyResearchBible(1), content: road.content };
  assert.equal(harmonizeDispute(bible, wallId, "Scoped interpretation", 13).content.notes, initial.notes);
  assert.equal(harmonizeDispute(bible, wallId, "Scoped interpretation", 13).content.disputes[0].id, wallId);
});

test("explicit source classification preserves its text and requires a locator for A", () => {
  const content = { ...emptyResearchContent(), sources: [source("one", "All text remains intact.", "")] };
  assert.match((classifyResearchSource(content, "one", "A") as { error: string }).error, /locator/);
  const classified = classifyResearchSource(content, "one", "D");
  if ("error" in classified) throw new Error(classified.error);
  assert.equal(classified.content.sources[0].confidence, "D");
  assert.equal(classified.content.sources[0].quote, content.sources[0].quote);
  assert.equal(classified.content.disputes.length, 0);
});
