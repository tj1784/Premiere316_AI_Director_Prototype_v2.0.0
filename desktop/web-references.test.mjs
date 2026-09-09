import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl } from './web-references.mjs';
test('web reference fetch cannot reach local services or read files', async () => {
  for (const url of ['http://127.0.0.1:1234/', 'http://10.1.2.3/', 'http://169.254.169.254/', 'http://[::1]/', 'file:///C:/secret', 'https://user:password@example.com/']) await assert.rejects(assertPublicUrl(url));
});
