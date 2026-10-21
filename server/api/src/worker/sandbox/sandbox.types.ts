import type { LlmProvider } from '../../config/configuration';

/**
 * Mirror of the contract emitted by the synclab-sandbox image. The sandbox is a
 * separate package built into its own container, so the two sides share this
 * shape by agreement rather than by import.
 */

export const RESULT_SENTINEL = '##SYNCLAB_RESULT##';

export const SANDBOX_PHASES = [
  'prepare',
  'install',
  'upgrade',
  'refactor',
  'test',
  'publish',
  'clone',
  'scan',
  'classify',
] as const;

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

export interface SandboxLlmParams {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  maxAttempts: number;
  maxFiles: number;
  maxFileBytes: number;
}

/** The brief the sandbox reads from API_CHANGE, as server/sandbox/src/config.ts validates it. */
export interface SandboxApiChange {
  provider: string;
  kind: string;
  operation: string | null;
  field: string | null;
  replacement: string | null;
  /** YYYY-MM-DD. */
  effectiveAt: string | null;
  evidence: string;
  sourceUrl: string;
}

/**
 * An API change runs on the SDK the repository already has: nothing records
 * which SDK version a change needs yet, so it never upgrades.
 */
export type SandboxMigration =
  | { kind: 'dependency'; dependencyName: string; targetVersion: string }
  | { kind: 'api_change'; change: SandboxApiChange; files: string[] };

export interface SandboxJobParams {
  repoUrl: string;
  repoFullName: string;
  migration: SandboxMigration;
  branchName: string;
  token: string;
  llm: SandboxLlmParams;
}

/** A scan clones the default branch and parses it; it needs nothing about a migration. */
export interface SandboxScanParams {
  repoUrl: string;
  token: string;
}

export const API_PROVIDER_SLUGS = ['anthropic', 'openai'] as const;

export type ApiProviderSlug = (typeof API_PROVIDER_SLUGS)[number];

/** One call the sandbox scanner found, as server/sandbox/src/analysis/api-usage.ts reports it. */
export interface ScannedApiUsage {
  provider: ApiProviderSlug;
  file: string;
  line: number;
  style: 'sdk' | 'http';
  method?: string;
  operation: string | null;
  params: string[];
  modelIds: string[];
  dynamic: boolean;
}

export interface SandboxScanOutcome {
  ok: boolean;
  error?: string;
  commitSha?: string;
  usages: ScannedApiUsage[];
  /** The step output of every phase that ran, for diagnosing the scan. */
  output: string;
}

/** What the classify phase reads from CLASSIFY_INPUT, base64-encoded JSON. */
export interface SandboxClassifyInput {
  provider: ApiProviderSlug;
  sourceKind: 'release_notes' | 'sdk_changelog';
  url: string;
  text: string;
}

export interface SandboxClassifyOutcome {
  ok: boolean;
  error?: string;
  /** Set when the failure is transient, such as a model rate limit. */
  retryable?: boolean;
  /** The model's candidates, unverified: check them with verifyClassified. */
  changes: unknown[];
  /** The step output of the phase, for diagnosing the classification. */
  output: string;
}

export interface SandboxRunOutcome {
  ok: boolean;
  error?: string;
  pullRequestUrl?: string;
  /** Set when the failure is transient, such as a model rate limit. */
  retryable?: boolean;
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

// Column widths in prisma/schema.prisma.
const MAX_FILE_LENGTH = 1024;
const MAX_NAME_LENGTH = 255;
// Far past any real repository; a cap keeps one scan from flooding the table.
export const MAX_SCANNED_USAGES = 5_000;

function isShortString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isShortString(item, MAX_NAME_LENGTH));
}

/**
 * The scan result is produced by our own code, but file paths and request
 * keys come from the repository, so every usage is checked against the
 * registry's columns before it is stored. A malformed entry is dropped.
 */
export function parseScannedUsages(value: unknown): ScannedApiUsage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const usages: ScannedApiUsage[] = [];
  for (const entry of value.slice(0, MAX_SCANNED_USAGES) as Array<Record<string, unknown>>) {
    if (
      entry !== null &&
      typeof entry === 'object' &&
      API_PROVIDER_SLUGS.includes(entry.provider as ApiProviderSlug) &&
      isShortString(entry.file, MAX_FILE_LENGTH) &&
      Number.isInteger(entry.line) &&
      (entry.line as number) >= 0 &&
      (entry.style === 'sdk' || entry.style === 'http') &&
      (entry.method === undefined || isShortString(entry.method, MAX_NAME_LENGTH)) &&
      (entry.operation === null || isShortString(entry.operation, MAX_NAME_LENGTH)) &&
      isStringList(entry.params) &&
      isStringList(entry.modelIds) &&
      typeof entry.dynamic === 'boolean'
    ) {
      usages.push({
        provider: entry.provider as ApiProviderSlug,
        file: entry.file,
        line: entry.line as number,
        style: entry.style,
        method: entry.method,
        operation: entry.operation,
        params: entry.params,
        modelIds: entry.modelIds,
        dynamic: entry.dynamic,
      });
    }
  }
  return usages;
}
