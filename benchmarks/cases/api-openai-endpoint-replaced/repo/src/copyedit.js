import OpenAI from 'openai';

const openai = new OpenAI();

const TONES = { friendly: 'warm and casual', formal: 'formal and concise' };

async function edit(input, instruction) {
  const response = await openai.edits.create({
    model: 'text-davinci-edit-001',
    input,
    instruction,
    temperature: 0,
  });
  return response.choices[0].text.trim();
}

/** Fixes spelling and grammar without changing the meaning. */
export function fixSpelling(text) {
  return edit(text, 'Fix the spelling and grammar. Do not change the meaning.');
}

/** Rewrites a release note in one of the house tones. */
export function rewriteInTone(text, tone) {
  if (!(tone in TONES)) throw new Error(`unknown tone "${tone}"`);
  return edit(text, `Rewrite the text so it sounds ${TONES[tone]}.`);
}
