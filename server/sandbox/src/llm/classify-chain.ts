import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { LlmConfig } from '../config.js';
import { PermanentModelError } from './errors.js';
import { createAnthropicClient, createGeminiModel } from './model.js';

export const CHANGE_KINDS = [
  'model_retired',
  'param_removed',
  'param_renamed',
  'param_now_required',
  'enum_value_removed',
  'endpoint_removed',
  'behavior_changed',
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface ClassifyInput {
  provider: 'anthropic' | 'openai';
  sourceKind: 'release_notes' | 'sdk_changelog';
  url: string;
  text: string;
}

export interface ClassifiedChange {
  kind: ChangeKind;
  operation: string | null;
  field: string | null;
  replacement: string | null;
  effectiveAt: string | null;
  evidence: string;
}

export interface ClassifyOutcome {
  changes: ClassifiedChange[];
  /** Items the model returned that did not have the expected shape. */
  dropped: number;
}

/**
 * What the model is asked to produce. It is deliberately loose (every field a
 * plain string or null) so that one odd item does not fail the whole reply:
 * each item is checked on its own by ChangeSchema afterwards.
 */
const ReplySchema = z.object({
  changes: z.array(
    z.object({
      kind: z.enum(CHANGE_KINDS),
      operation: z
        .string()
        .nullable()
        .describe('The HTTP method and path, such as "POST /v1/messages", or null.'),
      field: z
        .string()
        .nullable()
        .describe('The parameter name or model ID the change is about, or null.'),
      replacement: z
        .string()
        .nullable()
        .describe('What to use instead, when the text names it, or null.'),
      effectiveAt: z
        .string()
        .nullable()
        .describe('The date the change takes effect as YYYY-MM-DD, or null.'),
      evidence: z
        .string()
        .describe('A quote copied character for character from one line of the text.'),
    }),
  ),
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Column widths of breaking_changes in the API's Prisma schema.
const MAX_NAME_LENGTH = 255;
const MAX_REPLACEMENT_LENGTH = 1024;
// A release that breaks more than this at once is better read by a person.
const MAX_CHANGES = 50;

function optionalText(maxLength: number) {
  return z
    .string()
    .nullish()
    .transform((value) => {
      const text = value?.trim() ?? '';
      return text === '' ? null : text;
    })
    .refine((value) => value === null || value.length <= maxLength);
}

const ChangeSchema = z.object({
  kind: z.enum(CHANGE_KINDS),
  operation: optionalText(MAX_NAME_LENGTH),
  field: optionalText(MAX_NAME_LENGTH),
  replacement: optionalText(MAX_REPLACEMENT_LENGTH),
  // A date the model could not express as YYYY-MM-DD is dropped, not the change.
  effectiveAt: z
    .string()
    .regex(DATE)
    .nullable()
    .catch(null),
  evidence: z.string().trim().min(1),
});

/**
 * Keeps every item of a reply that has the expected shape. The API checks
 * again, and also that the evidence is really in the snapshot, because this
 * runs in the sandbox and the API is the trust boundary.
 */
export function validateChanges(reply: unknown): ClassifyOutcome {
  const items = (reply as { changes?: unknown } | null)?.changes;

  if (!Array.isArray(items)) {
    throw new PermanentModelError('The model reply has no "changes" list.');
  }

  const changes: ClassifiedChange[] = [];
  let dropped = 0;

  for (const item of items) {
    const parsed = ChangeSchema.safeParse(item);
    if (parsed.success && changes.length < MAX_CHANGES) {
      changes.push(parsed.data);
    } else {
      dropped++;
    }
  }

  return { changes, dropped };
}

/**
 * Reads the JSON object out of a plain-text reply. A model sometimes
 * wraps it in a fenced block or adds a sentence around it despite the format.
 */
export function parseJsonReply(reply: string): unknown {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');

  if (start === -1 || end < start) {
    throw new PermanentModelError('The model reply did not contain a JSON object.');
  }

  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new PermanentModelError('The model reply was not valid JSON.');
  }
}

export const SYSTEM_PROMPT = [
  'You read API release notes and SDK changelogs and list the breaking changes they announce for code that calls the API.',
  '',
  'A breaking change is one of these kinds:',
  '- model_retired: a model ID stops being served, or is scheduled to. field is the model ID.',
  '- param_removed: a request parameter is removed or rejected. field is the parameter.',
  '- param_renamed: a parameter moves to a new name or nesting. field is the old name, replacement the new one.',
  '- param_now_required: a request now needs a parameter it did not before. field is the parameter.',
  '- enum_value_removed: an accepted value of a parameter is gone. field is the parameter, replacement the value to use instead if named.',
  '- endpoint_removed: an endpoint or SDK method is removed. operation is the endpoint, replacement its successor if named.',
  '- behavior_changed: the same request now behaves or responds differently in a way callers must handle.',
  '',
  'Rules:',
  '- List only breaking changes. Never list new features, new models, new parameters, new endpoints, additions, bug fixes, documentation, performance work or internal chores.',
  '- A deprecation that only warns is not breaking. A removal, retirement or shutdown, including a scheduled one, is.',
  '- evidence must be copied exactly, character for character, from a single line of the text: no paraphrase, no ellipsis, no added or changed words. Quote the part of the line that states the change.',
  '- operation is the HTTP method and path, such as "POST /v1/messages", only when the text names or clearly implies it. Otherwise null.',
  '- effectiveAt is the date the change takes effect, as YYYY-MM-DD, only when the text states it. Otherwise null.',
  '- Use null for anything the text does not say. Never guess.',
  '- If the text announces no breaking change, return an empty list.',
].join('\n');


export function buildUserPrompt(input: ClassifyInput): string {
  const source = input.sourceKind === 'sdk_changelog' ? 'SDK changelog' : 'API release notes';

  return [
    `Provider: ${input.provider}`,
    `Source: ${source} at ${input.url}`,
    'These are the lines added to the source since it was last read. Each "## " line is a heading.',
    `<text>\n${input.text}\n</text>`,
  ].join('\n\n');
}

// The answer is a short list, so a few thousand tokens are plenty, and a cap
// stops a model that loses its way from running until the timeout.
const MAX_OUTPUT_TOKENS = 4_096;

export type ClassifyChain = (input: ClassifyInput) => Promise<ClassifyOutcome>;

export function createClassifyChain(llm: LlmConfig): ClassifyChain {
  switch (llm.provider) {
    case 'gemini':
      return createGeminiChain(llm);
    case 'anthropic':
      return createAnthropicChain(llm);
    case 'ollama':
      // A local model is no longer supported for classifying release notes.
      return () =>
        Promise.reject(
          new PermanentModelError(
            'Classifying release notes needs LLM_PROVIDER gemini or anthropic; ollama is not supported.',
          ),
        );
  }
}

function createGeminiChain(llm: LlmConfig): ClassifyChain {
  const model = createGeminiModel(llm).withStructuredOutput(ReplySchema);

  return async (input) =>
    validateChanges(
      await model.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) },
      ]),
    );
}

function createAnthropicChain(llm: LlmConfig): ClassifyChain {
  const client = createAnthropicClient();
  const { type, schema } = zodOutputFormat(ReplySchema);

  return async (input) => {
    const reply = await client.messages.create({
      model: llm.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Constrained decoding: the reply is always JSON in this schema.
      output_config: { format: { type, schema } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    });

    if (reply.stop_reason === 'refusal') {
      throw new PermanentModelError('The model declined to classify the text.');
    }

    if (reply.stop_reason === 'max_tokens') {
      throw new PermanentModelError('The model reply reached its output limit, so the list was cut off.');
    }

    const text = reply.content.map((block) => (block.type === 'text' ? block.text : '')).join('');

    return validateChanges(parseJsonReply(text));
  };
}
