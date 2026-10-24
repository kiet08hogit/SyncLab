import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider, userText } from './provider.js';

const provider = await startProvider({
  reply: (request) => {
    const text = userText(request);
    if (text.startsWith('Write a title')) return text.includes('VPN') ? '"VPN setup on a new laptop"' : '';
    return `You asked: ${text}`;
  },
});
process.env.ANTHROPIC_BASE_URL = provider.url;
process.env.ANTHROPIC_API_KEY = 'test-key';
const { reply } = await import('../src/chat.js');
const { titleFor } = await import('../src/titles.js');

after(() => provider.close());

test('answers the last turn of the conversation', async () => {
  const history = [
    { role: 'user', content: 'Where is the VPN guide?' },
    { role: 'assistant', content: 'Under IT.' },
    { role: 'user', content: 'And for macOS?' },
  ];
  assert.equal(await reply(history), 'You asked: And for macOS?');
  assert.deepEqual(provider.requests.at(-1).body.messages, history);
});

test('titles a conversation without quotes, and falls back when the model gives none', async () => {
  assert.equal(await titleFor('How do I set up the VPN on my new laptop?'), 'VPN setup on a new laptop');
  assert.equal(await titleFor('Hello'), 'New conversation');
});
