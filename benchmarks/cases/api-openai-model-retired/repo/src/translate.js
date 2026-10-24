import OpenAI from 'openai';

const openai = new OpenAI();
const MODEL = 'gpt-4.5-preview';

/** Translates UI strings, keeping {placeholders} untouched. */
export async function translate(strings, language) {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Translate every value of the JSON object into ${language}. Keep keys and {placeholders} unchanged. Reply with JSON only.`,
      },
      { role: 'user', content: JSON.stringify(strings) },
    ],
  });

  const translated = JSON.parse(completion.choices[0].message.content);
  for (const key of Object.keys(strings)) {
    if (typeof translated[key] !== 'string') translated[key] = strings[key];
  }
  return translated;
}
