import test from "node:test";
import assert from "node:assert/strict";
import { makePictureIntake } from "./picture-intake.ts";
import {
  appendResearchEvidence, explicitResearchRequest, forbidsWebResearch,
  hasSubstantiveSuppliedEvidence, importedResearchDocument, researchSearchQueries,
  requiresHistoricalEvidence, suppliedResearchUrls,
} from "./research-evidence.ts";
import {
  collectResearchEvidence, fetchResearchPage, readableResearchPage, researchSearchLinks,
} from "./research-evidence.server.ts";

const sourceText = "A certain man had two sons. And the younger of them said to his father, Father, give me the portion of goods that falleth to me. And he divided unto them his living.";
const html = `<html><head><title>Source text</title></head><body><nav>Buy a subscription</nav><main><p>${sourceText}</p><script>stealSecrets()</script></main></body></html>`;
const page = (url: string) => ({ url, type: "text/html", text: html });

test("a pasted intake requests evidence collection without publishing its full private brief", () => {
  const intake = { ...makePictureIntake(), concept: "Create a biblical film adapting Luke 15:11–32.\nFirst-century Judea\nResearch first-century Jewish culture before writing anything.\nPrivate financing note: do not publish this." };
  assert.equal(requiresHistoricalEvidence(intake), true);
  assert.equal(explicitResearchRequest(intake), true);
  const queries = researchSearchQueries(intake);
  assert.equal(queries[0], "Luke 15:11–32 source text");
  assert.ok(queries.some((query) => query.includes("First-century Judea")));
  assert.ok(queries.every((query) => !query.includes("Private financing")));
  assert.equal(explicitResearchRequest({ ...intake, directorNotes: "Do not browse or research online." }), false);
  assert.equal(forbidsWebResearch({ ...intake, directorNotes: "No web access. Use my pasted sources." }), true);
});

test("locators and screenplays cannot masquerade as supplied historical evidence", () => {
  const intake = { ...makePictureIntake(), sourceType: "biblical-historical" as const, sourcePassages: "Luke 15:11–32 https://example.org/luke" };
  assert.equal(hasSubstantiveSuppliedEvidence(intake), false);
  assert.equal(hasSubstantiveSuppliedEvidence({ ...intake, suppliedSourceText: sourceText }), true);
  assert.equal(hasSubstantiveSuppliedEvidence({ ...intake, importedSources: [{ fileName: "draft.fountain", mediaType: "text/fountain", importedAt: 1, text: sourceText }] }), false);
  assert.equal(hasSubstantiveSuppliedEvidence({ ...intake, importedSources: [importedResearchDocument({ url: "https://example.org/luke", title: "Luke", text: "", retrievedAt: 1 })] }), false);
});

test("retrieved evidence is bounded, attributed, deduplicated and never overwrites user edits", () => {
  const intake = { ...makePictureIntake(), suppliedSourceText: sourceText };
  const document = { url: "https://example.org/luke", title: "Luke", text: sourceText.repeat(100), retrievedAt: 1000 };
  const next = appendResearchEvidence(intake, [document]);
  assert.equal(next.suppliedSourceText, sourceText);
  assert.equal(next.importedSources.length, 1);
  assert.match(next.importedSources[0].text, /Source URL: https:\/\/example.org\/luke/);
  assert.match(next.importedSources[0].text, /Retrieved at: 1970-01-01T00:00:01.000Z/);
  assert.ok(next.importedSources[0].text.length < 8500);
  next.importedSources[0].text += "\nUser annotation.";
  assert.equal(appendResearchEvidence(next, [document]), next);
  assert.match(next.importedSources[0].text, /User annotation/);
});

test("text collection does not require an image and excludes scripts and navigation", () => {
  assert.deepEqual(readableResearchPage(page("https://example.org/source")), { title: "Source text", text: sourceText });
  assert.deepEqual(researchSearchLinks('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fmuseum.example%2Fobject">Object</a>'), ["https://museum.example/object"]);
});

test("supplied source URLs retrieve actual page text; search snippets alone are never evidence", async () => {
  const calls: string[] = [];
  const intake = { ...makePictureIntake(), sourcePassages: "Luke 15:11–32", suppliedSourceText: "https://example.org/first" };
  assert.deepEqual(suppliedResearchUrls(intake), ["https://example.org/first"]);
  const result = await collectResearchEvidence(intake, {
    allowSearch: true,
    now: () => 1,
    fetchPage: async (url) => {
      calls.push(url);
      if (url.includes("duckduckgo.com")) return { url, type: "text/html", text: '<a class="result__a" href="https://example.org/blocked">Text only result</a>' };
      if (url.includes("blocked")) throw new Error("Unavailable");
      return page(url);
    },
  });
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].text, sourceText);
  assert.equal(result.documents[0].retrievedAt, 1);
  assert.ok(result.warnings.some((warning) => warning.includes("Unavailable")));
  assert.equal(calls[0], "https://example.org/first");
  assert.ok(result.documents.every((document) => !document.url.includes("duckduckgo.com")));
});

test("local supplied text does not issue searches, while failed retrieval stays an explicit warning", async () => {
  let calls = 0;
  const result = await collectResearchEvidence({ ...makePictureIntake(), suppliedSourceText: sourceText }, { allowSearch: false, fetchPage: async () => { calls++; throw new Error("Unexpected network"); } });
  assert.equal(calls, 0);
  assert.deepEqual(result, { documents: [], warnings: [] });
  const failure = await collectResearchEvidence({ ...makePictureIntake(), suppliedSourceText: "https://example.org/broken" }, { allowSearch: false, fetchPage: async () => { throw new Error("Timeout"); } });
  assert.equal(failure.documents.length, 0);
  assert.match(failure.warnings[0], /Timeout/);
});

test("research fetch rejects private URLs, mixed DNS results and private redirects before requesting them", async () => {
  let calls = 0;
  const readPage = async () => { calls++; return { status: 200, type: "text/plain", bytes: new TextEncoder().encode(sourceText) }; };
  for (const url of ["http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "file:///etc/passwd", "https://user:password@example.com/", "https://example.com:444/"]) {
    await assert.rejects(fetchResearchPage(url, { readPage }));
  }
  assert.equal(calls, 0);
  await assert.rejects(fetchResearchPage("https://example.com", { resolve: async () => [{ address: "93.184.215.14", family: 4 }, { address: "192.168.0.1", family: 4 }], readPage }));
  assert.equal(calls, 0);
  await assert.rejects(fetchResearchPage("https://example.com", {
    resolve: async () => [{ address: "93.184.215.14", family: 4 }],
    readPage: async () => { calls++; return { status: 302, location: "http://127.0.0.1/admin", type: "text/html", bytes: new Uint8Array() }; },
  }));
  assert.equal(calls, 1);
});

test("research fetch pins the verified public address and enforces size/type/status limits", async () => {
  const resolve = async () => [{ address: "93.184.215.14", family: 4 }];
  const good = await fetchResearchPage("https://example.org/source", {
    resolve,
    readPage: async (url, address) => {
      assert.equal(url.hostname, "example.org");
      assert.equal(address.address, "93.184.215.14");
      return { status: 200, type: "text/plain", bytes: new TextEncoder().encode(sourceText) };
    },
  });
  assert.equal(good.text, sourceText);
  for (const response of [
    { status: 200, type: "text/plain", bytes: new Uint8Array(101) },
    { status: 200, type: "image/png", bytes: new Uint8Array() },
    { status: 403, type: "text/html", bytes: new Uint8Array() },
  ]) await assert.rejects(fetchResearchPage("https://example.org", { resolve, readPage: async () => response }, 100));
});
