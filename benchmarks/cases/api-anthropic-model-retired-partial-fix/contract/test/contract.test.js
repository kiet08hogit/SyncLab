import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider } from './provider.js';

const RETIRED = 'claude-3-7-sonnet-20250219';

const provider = await startProvider({
  reply: () => 'Printer queue',
  reject: ({ body }) =>
    body.model === RETIRED ? { status: 404, error: { type: 'not_found_error', message: `model: ${RETIRED}` } } : undefined,
});
process.env.ANTHROPIC_BASE_URL = provider.url;
process.env.ANTHROPIC_API_KEY = 'test-key';
const { reply } = await import('../src/chat.js');
const { titleFor } = await import('../src/titles.js');

after(() => provider.close());

test('the API accepts the chat request after Claude Sonnet 3.7 is retired', async () => {
  assert.equal(await reply([{ role: 'user', content: 'Is the printer down?' }]), 'Printer queue');
});

test('the API accepts the title request after Claude Sonnet 3.7 is retired', async () => {
  assert.equal(await titleFor('Is the printer down?'), 'Printer queue');
});
