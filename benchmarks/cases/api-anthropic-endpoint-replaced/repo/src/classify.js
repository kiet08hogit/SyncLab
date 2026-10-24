import Anthropic, { AI_PROMPT, HUMAN_PROMPT } from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

const LABELS = ['positive', 'neutral', 'negative'];

/** Labels the sentiment of a product review, or null when the model strays. */
export async function classifySentiment(review) {
  const completion = await anthropic.completions.create({
    model: 'claude-2.1',
    max_tokens_to_sample: 5,
    stop_sequences: [HUMAN_PROMPT],
    prompt: `${HUMAN_PROMPT} Label the sentiment of this review as ${LABELS.join(', ')}. Answer with the label only.\n\n<review>${review}</review>${AI_PROMPT}`,
  });

  const label = completion.completion.trim().toLowerCase();
  return LABELS.includes(label) ? label : null;
}
