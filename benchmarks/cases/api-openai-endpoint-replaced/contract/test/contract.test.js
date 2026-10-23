import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider } from './provider.js';

const provider = await startProvider({
  reply: () => 'Edited.',
  reject: ({ path }) =>
    path === '/v1/edits'
      ? {
          status: 404,
          error: { message: 'Invalid URL (POST /v1/edits)', type: 'invalid_request_error', param: null, code: null },
        }
      : undefined,
});
process.env.OPENAI_BASE_URL = provider.url;
process.env.OPENAI_API_KEY = 'test-key';
const { fixSpelling, rewriteInTone } = await import('../src/copyedit.js');

after(() => provider.close());

test('both edits work after the Edits endpoint is shut down', async () => {
  assert.equal(await fixSpelling('Read teh notes.'), 'Edited.');
  assert.equal(await rewriteInTone('v2 shipped', 'formal'), 'Edited.');
  assert.ok(provider.requests.every((request) => request.path === '/v1/chat/completions'));
});
