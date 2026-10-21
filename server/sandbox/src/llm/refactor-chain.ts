import { z } from 'zod';
import type { ApiChange, SandboxConfig } from '../config.js';
import type { DependencyUsage } from '../analysis/imports.js';
import { PermanentModelError } from './errors.js';
import { createAnthropicClient, createGeminiModel } from './model.js';

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
  'You migrate JavaScript and TypeScript source files to a new version of a dependency, or off a breaking change in an API they call.',
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
 * Claude answers in plain text with the file in a fenced block, the shape
 * coding models are trained to close: the file comes back without JSON
 * escaping, and a cut-off reply is reported by the stop reason rather than by
 * a parse failure that hides it.
 */
const FENCED_SYSTEM_PROMPT = [
  ...RULES,
  '- Start with one sentence explaining what you changed, or why nothing needed changing.',
  '- If the file needs changes, follow that sentence with the complete file in a single ``` fenced block and write nothing after the block.',
  '- If the file needs no changes, write only the sentence.',
].join('\n');

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

function describeApiChange(change: ApiChange): string {
  return [
    `Breaking change in the ${change.provider} API: ${change.kind}`,
    change.operation && `Operation: ${change.operation}`,
    change.field && `Affected parameter or model: ${change.field}`,
    change.replacement && `Replacement: ${change.replacement}`,
    change.effectiveAt && `Effective: ${change.effectiveAt}`,
    `Quoted from ${change.sourceUrl}:\n${change.evidence}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildUserPrompt(config: SandboxConfig, request: RefactorRequest): string {
  const { migration } = config;
  const sections =
    migration.kind === 'api_change' ? [describeApiChange(migration.change)] : [];

  if (migration.dependency) {
    sections.push(
      `Dependency: ${migration.dependency.name}`,
      `Target version: ${migration.dependency.version}`,
    );
  }

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
  switch (config.llm.provider) {
    case 'gemini':
      return createStructuredChain(config);
    case 'anthropic':
      return createAnthropicChain(config);
  }
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

// Room for adaptive thinking as well as the largest file LLM_MAX_FILE_BYTES
// lets through. Streaming keeps a reply this long clear of HTTP timeouts.
const ANTHROPIC_MAX_TOKENS = 64_000;

function createAnthropicChain(config: SandboxConfig): RefactorChain {
  const client = createAnthropicClient();

  return async (request) => {
    const stream = client.beta.messages.stream({
      model: config.llm.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      output_config: { effort: 'high' },
      // A safety classifier can decline a request about source code. The
      // server then retries it on the fallback model it recommends.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: FENCED_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(config, request) }],
    });
    const reply = await stream.finalMessage();

    if (reply.stop_reason === 'refusal') {
      throw new PermanentModelError(
        `The model declined to rewrite the file (${reply.stop_details?.category ?? 'no category'}).`,
      );
    }

    if (reply.stop_reason === 'max_tokens') {
      throw new PermanentModelError(
        'The model reply reached its output limit, so the file was cut off.',
      );
    }

    const text = reply.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    return parseFencedReply(text, request.contents);
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
    throw new PermanentModelError(
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
