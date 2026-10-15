import { z } from 'zod';
import type { SandboxConfig } from '../config.js';
import type { DependencyUsage } from '../analysis/imports.js';
import { createGeminiModel, createOllamaModel } from './model.js';

/**
 * A whole-file rewrite rather than a diff. Models produce diffs that fail to
 * apply often enough that the retry loop would be spent on patch errors rather
 * than on real migration mistakes.
 */
const RefactorSchema = z.object({
  changed: z
    .boolean()
    .describe('True only if the file needed edits for this migration.'),
  contents: z
    .string()
    .describe('The complete rewritten file. Empty string when changed is false.'),
  reason: z
    .string()
    .describe('One sentence explaining what was changed, or why nothing was.'),
});

const RULES = [
  'You migrate JavaScript and TypeScript source files to a new version of a dependency.',
  '',
  'Rules:',
  '- Return the complete file, not a diff and not an excerpt.',
  '- Change only what the migration requires. Preserve unrelated code, comments, imports, and formatting exactly.',
  '- Never invent APIs. If you are unsure whether an API exists in the target version, leave the code alone.',
];

const STRUCTURED_SYSTEM_PROMPT = [
  ...RULES,
  '- If the file needs no changes, set changed to false and leave contents empty.',
].join('\n');

/**
 * Small local models cannot be trusted to end a whole file inside a JSON
 * string: under constrained decoding they keep appending to it until the
 * output limit. A fenced block is the shape coding models are trained to
 * close, so local models answer in plain text instead.
 */
const FENCED_SYSTEM_PROMPT = [
  ...RULES,
  '- Start with one sentence explaining what you changed, or why nothing needed changing.',
  '- If the file needs changes, follow that sentence with the complete file in a single ``` fenced block and write nothing after the block.',
  '- If the file needs no changes, write only the sentence.',
].join('\n');

// Code averages three to four characters per token, so this leaves the model
// about twice the room the file needs, plus space for the reason.
const OUTPUT_TOKENS_PER_CHARACTER = 0.5;
const OUTPUT_TOKEN_HEADROOM = 512;

// The low end for code, so the estimate errs towards a prompt being larger
// than it is.
const CHARACTERS_PER_TOKEN = 3;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN);
}

export interface RefactorRequest {
  relativePath: string;
  contents: string;
  usage: DependencyUsage;
  breakingChanges?: string;
  previousTestOutput?: string;
}

export interface RefactorOutcome {
  changed: boolean;
  contents: string;
  reason: string;
}

function buildUserPrompt(config: SandboxConfig, request: RefactorRequest): string {
  const sections = [
    `Dependency: ${config.dependencyName}`,
    `Target version: ${config.targetVersion}`,
  ];

  if (request.breakingChanges?.trim()) {
    sections.push(`Release notes for the target version:\n${request.breakingChanges.trim()}`);
  }

  if (request.previousTestOutput?.trim()) {
    sections.push(
      [
        'A previous attempt at this migration was rejected by the test suite.',
        'Study the failure and correct the mistake in this attempt:',
        request.previousTestOutput.trim(),
      ].join('\n'),
    );
  }

  if (request.usage.importedNames.length > 0) {
    sections.push(`Imported from the dependency: ${request.usage.importedNames.join(', ')}`);
  }

  if (request.usage.usageLines.length > 0) {
    sections.push(`Referenced on lines: ${request.usage.usageLines.join(', ')}`);
  }

  sections.push(`File: ${request.relativePath}`, `\`\`\`\n${request.contents}\n\`\`\``);

  return sections.join('\n\n');
}

export type RefactorChain = (request: RefactorRequest) => Promise<RefactorOutcome>;

export function createRefactorChain(config: SandboxConfig): RefactorChain {
  return config.llm.provider === 'gemini'
    ? createStructuredChain(config)
    : createFencedChain(config);
}

function createStructuredChain(config: SandboxConfig): RefactorChain {
  const model = createGeminiModel(config.llm).withStructuredOutput(RefactorSchema);

  return async (request) => {
    const result = await model.invoke([
      { role: 'system', content: STRUCTURED_SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(config, request) },
    ]);

    return {
      changed: result.changed,
      contents: result.contents,
      reason: result.reason,
    };
  };
}

function createFencedChain(config: SandboxConfig): RefactorChain {
  return async (request) => {
    const userPrompt = buildUserPrompt(config, request);
    // Ollama drops the start of the prompt or stops the reply without an error
    // once the context is full, so a file whose prompt and rewrite cannot both
    // fit is refused up front.
    const roomLeft =
      config.llm.numCtx - estimateTokens(FENCED_SYSTEM_PROMPT) - estimateTokens(userPrompt);

    if (roomLeft < estimateTokens(request.contents) + OUTPUT_TOKEN_HEADROOM) {
      throw new Error(
        `${request.relativePath} is too large to rewrite within the ${config.llm.numCtx} token context window. Raise LLM_NUM_CTX or lower LLM_MAX_FILE_BYTES.`,
      );
    }

    const maxOutputTokens = Math.min(
      Math.ceil(request.contents.length * OUTPUT_TOKENS_PER_CHARACTER) + OUTPUT_TOKEN_HEADROOM,
      roomLeft,
    );
    const model = createOllamaModel(config.llm, maxOutputTokens);
    const reply = await model.invoke([
      { role: 'system', content: FENCED_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

    // A fence inside the file can pass for the closing one, so only Ollama
    // knows for sure that the reply ran out of room.
    if (reply.response_metadata?.done_reason === 'length') {
      throw new Error('The model reply reached its output limit, so the file was cut off.');
    }

    return parseFencedReply(reply.text, request.contents);
  };
}

const FENCE = '```';

/**
 * Reads "reason, then optionally the whole file in one fenced block". The
 * last fence closes the block, so a file that itself contains a fence (in a
 * template string or a comment) survives intact.
 */
export function parseFencedReply(reply: string, original: string): RefactorOutcome {
  const open = reply.indexOf(FENCE);

  if (open === -1) {
    return { changed: false, contents: '', reason: oneLine(reply) };
  }

  const reason = oneLine(reply.slice(0, open));
  const bodyStart = reply.indexOf('\n', open);
  const close = reply.lastIndexOf(FENCE);

  if (bodyStart === -1 || close <= bodyStart) {
    throw new Error(
      'The model reply opened a code block but never closed it, so the file was cut off.',
    );
  }

  // The closing fence sits on its own line, so the body ends with the newline
  // before it. Match the original's trailing newline rather than the model's.
  const body = reply.slice(bodyStart + 1, close).replace(/\n$/, '');
  const contents = original.endsWith('\n') ? `${body}\n` : body;

  return { changed: contents !== original, contents, reason };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
