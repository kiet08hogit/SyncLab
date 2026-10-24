import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider } from './provider.js';

/** The instruction and the text of a request, whichever endpoint it went to. */
function parts({ body }) {
  if (typeof body.instruction === 'string') return { instruction: body.instruction, text: body.input };
  const all = body.messages.map((message) => message.content).join('\n');
  return { instruction: all, text: body.messages.at(-1).content };
}

const provider = await startProvider({
  reply: (request) => {
    const { instruction, text } = parts(request);
    if (/spelling/.test(instruction)) return `${text.replace('teh', 'the')}\n`;
    return /formal/.test(instruction) ? 'Version 2 is available.' : 'Hey, version 2 is out!';
  },
});
process.env.OPENAI_BASE_URL = provider.url;
process.env.OPENAI_API_KEY = 'test-key';
const { fixSpelling, rewriteInTone } = await import('../src/copyedit.js');

after(() => provider.close());

test('fixes spelling and trims the result', async () => {
  assert.equal(await fixSpelling('Read teh notes.'), 'Read the notes.');
});

test('rewrites in each house tone', async () => {
  assert.equal(await rewriteInTone('v2 shipped', 'formal'), 'Version 2 is available.');
  assert.equal(await rewriteInTone('v2 shipped', 'friendly'), 'Hey, version 2 is out!');
});

test('rejects an unknown tone without calling the API', async () => {
  const before = provider.requests.length;
  assert.throws(() => rewriteInTone('v2 shipped', 'pirate'), /unknown tone/);
  assert.equal(provider.requests.length, before);
});
