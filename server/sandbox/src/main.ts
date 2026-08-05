import { prepare } from './phases/prepare.js';
import { refactor } from './phases/refactor.js';
import { test } from './phases/test.js';
import { publish } from './phases/publish.js';
import { emitResult, type PhaseName, type PhaseResult } from './result.js';

const PHASES: Record<PhaseName, () => Promise<PhaseResult>> = {
  prepare,
  refactor,
  test,
  publish,
};

function parsePhase(value: string | undefined): PhaseName {
  if (value && value in PHASES) {
    return value as PhaseName;
  }
  throw new Error(`Expected one of ${Object.keys(PHASES).join(', ')} but received "${value ?? ''}"`);
}

async function main(): Promise<void> {
  const phase = parsePhase(process.argv[2]);

  let result: PhaseResult;
  try {
    result = await PHASES[phase]();
  } catch (error: unknown) {
    result = {
      phase,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      steps: [],
    };
  }

  emitResult(result);
  process.exitCode = result.ok ? 0 : 1;
}

void main();
