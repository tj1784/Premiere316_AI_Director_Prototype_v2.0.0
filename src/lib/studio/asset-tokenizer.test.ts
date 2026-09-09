import test from "node:test";
import assert from "node:assert/strict";
import { assetTokenizerIdentity, countImagePromptTokens, releaseAssetTokenizer } from "./flux2-tokenizer.server.ts";
import { existsSync, readFileSync } from "node:fs";

test("tokenizer selection keeps FLUX defaults and binds KREA to its native Qwen conditioner", () => {
  assert.equal(assetTokenizerIdentity().engineId, "flux2");
  assert.equal(assetTokenizerIdentity("flux2").modelId, "mistralai/Mistral-Small-3.1-24B-Instruct-2503");
  assert.equal(assetTokenizerIdentity("krea-2").modelId, "Qwen/Qwen3-VL-4B-Instruct");
  assert.throws(() => assetTokenizerIdentity("unknown"), /No asset prompt tokenizer/);
});

test("Windows tokenizer pipe preserves Unicode model prose", { skip: !existsSync("D:/Projects/krea-2/local-components/qwen3-vl-4b/tokenizer.json") }, async () => {
  try {
    const count = await countImagePromptTokens('“Ancient sea walls” — limestone, blue‑green water, sunlight ☀.', 'krea-2');
    assert.ok(Number.isInteger(count) && count > 0);
    const fixture = 'screenshots/moses-restart/tokenizer-failure-output.json';
    if (existsSync(fixture)) {
      const row = JSON.parse(readFileSync(fixture, 'utf8')).assets[0];
      assert.equal(await countImagePromptTokens(row.promptParagraphs.join('\n\n').trim(), 'krea-2'), 1705);
    }
  } finally { releaseAssetTokenizer(); }
});
