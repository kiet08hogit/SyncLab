import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createGeminiModel } from './model.js';
import { tokenUsage } from './token-usage.js';

it('collects Gemini usage from a real LangChain response callback', async (t) => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fixture-key';
  t.after(() => {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ text: 'hello' }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 },
  }), { headers: { 'content-type': 'application/json' } }));
  const model = createGeminiModel({ provider: 'gemini', model: 'gemini-3.1-pro-preview', attempt: 1, maxAttempts: 1, maxFiles: 20, maxFileBytes: 60000 });
  await model.invoke('hello');
  assert.deepEqual(tokenUsage(), { input: 12, output: 5 });
});
