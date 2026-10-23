import { prepare } from './phases/prepare.js';
import { install } from './phases/install.js';
import { upgrade } from './phases/upgrade.js';
import { refactor } from './phases/refactor.js';
import { test } from './phases/test.js';
import { validate } from './phases/validate.js';
import { publish } from './phases/publish.js';
import { clone } from './phases/clone.js';
import { scan } from './phases/scan.js';
import { classify } from './phases/classify.js';
import { emitResult, type PhaseName, type PhaseResult } from './result.js';

const PHASES: Record<PhaseName, () => Promise<PhaseResult>> = {
  prepare,
  install,
  upgrade,
  refactor,
  test,
  validate,
  publish,
  clone,
  scan,
  classify,
};

function parsePhase(value: string | undefined): PhaseName {
  if (value && Object.hasOwn(PHASES, value)) {
    return value as PhaseName;
  }
  throw new Error(`Expected one of ${Object.keys(PHASES).join(', ')} but received "${value ?? ''}"`);
}

async function main(): Promise<void> {
  let phase: PhaseName;
  try {
    phase = parsePhase(process.argv[2]);
  } catch (error: unknown) {
    // No result line: there is no phase to report it for, and the worker
    // already treats a container that exits without one as failed.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }

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
