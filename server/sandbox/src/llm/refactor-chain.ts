import { z } from 'zod';
import type { SandboxConfig } from '../config.js';
import type { DependencyUsage } from '../analysis/imports.js';
import { createModel } from './model.js';

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

const SYSTEM_PROMPT = [
  'You migrate JavaScript and TypeScript source files to a new version of a dependency.',
  '',
  'Rules:',
  '- Return the complete file, not a diff and not an excerpt.',
  '- Change only what the migration requires. Preserve unrelated code, comments, imports, and formatting exactly.',
  '- Never invent APIs. If you are unsure whether an API exists in the target version, leave the code alone.',
  '- If the file needs no changes, set changed to false and leave contents empty.',
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
  const model = createModel(config.llm).withStructuredOutput(RefactorSchema);

  return async (request) => {
    const result = await model.invoke([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(config, request) },
    ]);

    return {
      changed: result.changed,
      contents: result.contents,
      reason: result.reason,
    };
  };
}
