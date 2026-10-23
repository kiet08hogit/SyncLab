import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

const LABELS = ['positive', 'neutral', 'negative'];

/** Labels the sentiment of a product review, or null when the model strays. */
export async function classifySentiment(review) {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 5,
    messages: [
      {
        role: 'user',
        content: `Label the sentiment of this review as ${LABELS.join(', ')}. Answer with the label only.\n\n<review>${review}</review>`,
      },
    ],
  });

  const label = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
    .toLowerCase();
  return LABELS.includes(label) ? label : null;
}
