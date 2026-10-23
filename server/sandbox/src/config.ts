import path from 'node:path';
import { z } from 'zod';

export const LLM_PROVIDERS = ['gemini', 'anthropic'] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  attempt: number;
  maxAttempts: number;
  maxFiles: number;
  maxFileBytes: number;
}

export interface DependencyTarget {
  name: string;
  version: string;
}

/** behavior_changed is reported, never migrated, so it is not accepted here. */
const ApiChangeSchema = z.object({
  provider: z.string().min(1),
  kind: z.enum([
    'model_retired',
    'param_removed',
    'param_renamed',
    'param_now_required',
    'enum_value_removed',
    'endpoint_removed',
  ]),
  operation: z.string().min(1).nullish(),
  field: z.string().min(1).nullish(),
  replacement: z.string().min(1).nullish(),
  effectiveAt: z.iso.date().nullish(),
  evidence: z.string().min(1),
  sourceUrl: z.url(),
});

export type ApiChange = z.infer<typeof ApiChangeSchema>;

const TargetFilesSchema = z
  .array(
    z
      .string()
      .refine(
        (file) =>
          file !== '' &&
          !path.posix.isAbsolute(file) &&
          path.posix.normalize(file) === file &&
          file !== '..' &&
          !file.startsWith('../'),
        { message: 'must be a normalized path inside the repository' },
      ),
  )
  .min(1);

/**
 * An API change keeps the SDK the repository already has unless the change
 * needs a newer one, in which case the dependency to upgrade comes with it.
 */
export type Migration =
  | { kind: 'dependency'; dependency: DependencyTarget }
  | { kind: 'api_change'; change: ApiChange; files: string[]; dependency?: DependencyTarget };

export interface SandboxConfig {
  workspace: string;
  repoDir: string;
  stateDir: string;
  repoUrl: string;
  repoFullName: string;
  migration: Migration;
  branchName: string;
  githubApiUrl: string;
  llm: LlmConfig;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveLlmProvider(value: string | undefined): LlmProvider {
  if (!value) {
    return 'gemini';
  }

  if (!LLM_PROVIDERS.includes(value as LlmProvider)) {
    throw new Error(`LLM_PROVIDER must be one of ${LLM_PROVIDERS.join(', ')}, got "${value}".`);
  }

  return value as LlmProvider;
}

/** Where the shared volume holds the clone and the state passed between phases. */
export function loadWorkspace(): Pick<SandboxConfig, 'workspace' | 'repoDir' | 'stateDir'> {
  const workspace = process.env.SANDBOX_WORKSPACE ?? '/workspace';

  return {
    workspace,
    repoDir: path.join(workspace, 'repo'),
    stateDir: path.join(workspace, 'state'),
  };
}

export function loadConfig(): SandboxConfig {
  return {
    ...loadWorkspace(),
    repoUrl: required('REPO_URL'),
    repoFullName: required('REPO_FULL_NAME'),
    migration: loadMigration(),
    branchName: required('BRANCH_NAME'),
    githubApiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    llm: loadLlmConfig(),
  };
}

function parseJson<T>(name: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(required(name));
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new Error(`${name} must be JSON: ${error.message}`);
    }
    throw error;
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${name} is invalid: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

function loadMigration(): Migration {
  const kind = process.env.MIGRATION_KIND || 'dependency';

  if (kind === 'dependency') {
    return {
      kind,
      dependency: { name: required('DEPENDENCY_NAME'), version: required('TARGET_VERSION') },
    };
  }

  if (kind !== 'api_change') {
    throw new Error(`MIGRATION_KIND must be dependency or api_change, got "${kind}".`);
  }

  const change = parseJson('API_CHANGE', ApiChangeSchema);
  const files = parseJson('TARGET_FILES', TargetFilesSchema);

  if (!process.env.DEPENDENCY_NAME && !process.env.TARGET_VERSION) {
    return { kind, change, files };
  }

  return {
    kind,
    change,
    files,
    dependency: { name: required('DEPENDENCY_NAME'), version: required('TARGET_VERSION') },
  };
}

/** The model settings alone, for the classify phase, which has no repository or job. */
export function loadLlmConfig(): LlmConfig {
  return {
    provider: resolveLlmProvider(process.env.LLM_PROVIDER),
    model: required('LLM_MODEL'),
    attempt: positiveNumber(process.env.REFACTOR_ATTEMPT, 1),
    maxAttempts: positiveNumber(process.env.REFACTOR_MAX_ATTEMPTS, 1),
    maxFiles: positiveNumber(process.env.LLM_MAX_FILES, 20),
    maxFileBytes: positiveNumber(process.env.LLM_MAX_FILE_BYTES, 60_000),
  };
}

/** The clone phase only needs to know what to clone, not the rest of the job. */
export function requireRepoUrl(): string {
  return required('REPO_URL');
}

/**
 * Only the prepare, clone and publish phases receive a token. The test phase runs
 * untrusted repository code, so its container is started without one, and the
 * refactor phase has no reason to reach GitHub.
 */
export function requireToken(): string {
  return required('GITHUB_TOKEN');
}

/**
 * Only the refactor and classify phases talk to the model provider.
 */
export function requireGeminiKey(): string {
  return required('GEMINI_API_KEY');
}

export function requireAnthropicKey(): string {
  return required('ANTHROPIC_API_KEY');
}
