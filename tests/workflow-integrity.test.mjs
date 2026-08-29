import assert from "node:assert/strict";
import test from "node:test";

import {
  crlfJsonSha256,
  jsonSha256Matches,
  normalizedJsonSha256,
  rawSha256
} from "../server/workflow-integrity.js";

test("workflow JSON hashes are stable across LF and CRLF checkouts", () => {
  const lf = Buffer.from('{\n  "1": { "class_type": "Example", "inputs": {} }\n}\n');
  const crlf = Buffer.from(lf.toString("utf8").replace(/\n/g, "\r\n"));
  const expected = rawSha256(lf);

  assert.notEqual(rawSha256(crlf), expected);
  assert.equal(normalizedJsonSha256(crlf), expected);
  assert.equal(jsonSha256Matches(expected, lf), true);
  assert.equal(jsonSha256Matches(expected, crlf), true);
  assert.equal(jsonSha256Matches(crlfJsonSha256(crlf), lf), true);
  assert.equal(jsonSha256Matches(crlfJsonSha256(crlf), crlf), true);
});

test("workflow JSON hash matching still rejects semantic byte changes", () => {
  const expected = rawSha256(Buffer.from('{"value":1}\n'));
  assert.equal(jsonSha256Matches(expected, Buffer.from('{"value":2}\r\n')), false);
  assert.equal(jsonSha256Matches("not-a-sha256", Buffer.from('{}\n')), false);
});
