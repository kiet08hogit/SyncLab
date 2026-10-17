import { loadLlmConfig } from '../config.js';
import { createClassifyChain, type ClassifyInput } from '../llm/classify-chain.js';
import { isRetryableModelError } from '../llm/errors.js';
import type { PhaseResult } from '../result.js';

const PROVIDERS = ['anthropic', 'openai'];
const SOURCE_KINDS = ['release_notes', 'sdk_changelog'];

/** CLASSIFY_INPUT is base64 so that any text survives the trip through a container environment. */
export function readClassifyInput(value: string | undefined): ClassifyInput {
  if (!value) {
    throw new Error('Missing required environment variable CLASSIFY_INPUT');
  }

  let input: Partial<ClassifyInput>;
  try {
    input = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Partial<ClassifyInput>;
  } catch {
    throw new Error('CLASSIFY_INPUT is not base64-encoded JSON');
  }

  if (
    !PROVIDERS.includes(input?.provider as string) ||
    !SOURCE_KINDS.includes(input?.sourceKind as string) ||
    typeof input.url !== 'string' ||
    typeof input.text !== 'string'
  ) {
    throw new Error('CLASSIFY_INPUT needs a provider, a sourceKind, a url and a text');
  }

  return input as ClassifyInput;
}

/**
 * Asks the model which breaking API changes the given release notes announce.
 * It runs none of a repository's code and reads nothing from the volume: its
 * whole input arrives in the environment and its answer leaves in the result.
 */
export async function classify(): Promise<PhaseResult> {
  const input = readClassifyInput(process.env.CLASSIFY_INPUT);
  const llm = loadLlmConfig();

  try {
    const { changes, dropped } = await createClassifyChain(llm)(input);
    const lines = [
      `Classified ${input.text.length} characters of ${input.url} using ${llm.model}.`,
      `Found ${changes.length} breaking change(s).`,
      ...changes.map((change) => `${change.kind} ${change.operation ?? '-'} ${change.field ?? '-'}`),
    ];
    if (dropped > 0) {
      lines.push(`Dropped ${dropped} malformed item(s) from the model reply.`);
    }

    return {
      phase: 'classify',
      ok: true,
      steps: [{ step: 'CLASSIFY', output: lines.join('\n') }],
      data: { changes, dropped },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      phase: 'classify',
      ok: false,
      error: `model call failed: ${message}`,
      steps: [{ step: 'CLASSIFY', output: message }],
      data: { retryable: isRetryableModelError(error) },
    };
  }
}
