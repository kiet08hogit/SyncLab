/**
 * Mirror of the contract emitted by the synclab-sandbox image. The sandbox is a
 * separate package built into its own container, so the two sides share this
 * shape by agreement rather than by import.
 */
export const RESULT_SENTINEL = '##SYNCLAB_RESULT##';

export const SANDBOX_PHASES = ['prepare', 'migrate', 'publish'] as const;

export type SandboxPhase = (typeof SANDBOX_PHASES)[number];

export interface StepLog {
  step: string;
  output: string;
  exitCode?: number;
}

export interface PhaseResult {
  phase: SandboxPhase;
  ok: boolean;
  error?: string;
  steps: StepLog[];
  data?: Record<string, unknown>;
}

export interface SandboxJobParams {
  repoUrl: string;
  repoFullName: string;
  dependencyName: string;
  targetVersion: string;
  branchName: string;
  codemodSearch: string;
  codemodReplace: string;
  token: string;
}

export interface SandboxRunOutcome {
  ok: boolean;
  error?: string;
  pullRequestUrl?: string;
}

/**
 * Scans backwards so a repository whose own output happens to contain the
 * sentinel cannot shadow the real result, which is always emitted last.
 */
export function parsePhaseResult(logs: string): PhaseResult | undefined {
  const lines = logs.split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    const index = lines[i].indexOf(RESULT_SENTINEL);
    if (index === -1) {
      continue;
    }

    try {
      return JSON.parse(lines[i].slice(index + RESULT_SENTINEL.length)) as PhaseResult;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
