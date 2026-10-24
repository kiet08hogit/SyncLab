import OpenAI from 'openai';

const openai = new OpenAI();

/** Defines a product term in one sentence for the translators' glossary. */
export async function define(term) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: `Define "${term}" in one sentence for a translator.` }],
  });
  return completion.choices[0].message.content.trim();
}
