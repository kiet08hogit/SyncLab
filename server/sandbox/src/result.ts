export const RESULT_SENTINEL = '##SYNCLAB_RESULT##';

export type PhaseName = 'prepare' | 'migrate' | 'publish';

export interface StepLog {
  step: string;
  output: string;
  exitCode?: number;
}

export interface PhaseResult {
  phase: PhaseName;
  ok: boolean;
  error?: string;
  steps: StepLog[];
  data?: Record<string, unknown>;
}

export function emitResult(result: PhaseResult): void {
  process.stdout.write(`\n${RESULT_SENTINEL}${JSON.stringify(result)}\n`);
}
