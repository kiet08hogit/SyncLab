import { readFileSync } from 'node:fs';
import * as dotenv from 'dotenv';

dotenv.config();

const MEGABYTE = 1024 * 1024;

export interface RedisConfig {
  host: string;
  port: number;
}

export interface GithubConfig {
  appId?: string;
  privateKey?: string;
  webhookSecret?: string;
  token?: string;
  apiUrl: string;
}

export interface SandboxConfig {
  image: string;
  timeoutMs: number;
  memoryBytes: number;
  nanoCpus: number;
  pidsLimit: number;
  dockerSocketPath?: string;
}

export const LLM_PROVIDERS = ['ollama', 'gemini', 'anthropic'] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const DEFAULT_LLM_MODELS: Record<LlmProvider, string> = {
  ollama: 'qwen2.5-coder:14b',
  gemini: 'gemini-3.1-pro-preview',
  anthropic: 'claude-opus-5-5',
};

/** The variable each hosted provider reads its key from. A local Ollama needs none. */
export const LLM_API_KEY_ENV: Record<LlmProvider, string | null> = {
  ollama: null,
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

export interface LlmConfig {
  provider: LlmProvider;
  /** Only used by the hosted providers, read from LLM_API_KEY_ENV. */
  apiKey: string;
  /** Only used by the Ollama provider, and resolved from inside the sandbox container. */
  baseUrl: string;
  /** Only used by the Ollama provider. */
  numCtx: number;
  model: string;
  maxAttempts: number;
  maxFiles: number;
  maxFileBytes: number;
}

export const APP_ROLES = ['all', 'gateway', 'worker'] as const;

export type AppRole = (typeof APP_ROLES)[number];

export interface WorkerRuntimeConfig {
  concurrency: number;
}

export interface ApiMonitorConfig {
  /** Whether workers poll the providers' sources on a schedule. */
  enabled: boolean;
  intervalMs: number;
}

export interface Configuration {
  appRole: AppRole;
  redis: RedisConfig;
  github: GithubConfig;
  sandbox: SandboxConfig;
  llm: LlmConfig;
  worker: WorkerRuntimeConfig;
  apiMonitor: ApiMonitorConfig;
  migrationsApiToken?: string;
}

export function resolveAppRole(value: string | undefined): AppRole {
  return APP_ROLES.includes(value as AppRole) ? (value as AppRole) : 'all';
}

export function resolveLlmProvider(value: string | undefined): LlmProvider {
  if (!value) {
    return 'ollama';
  }

  if (!LLM_PROVIDERS.includes(value as LlmProvider)) {
    throw new Error(`LLM_PROVIDER must be one of ${LLM_PROVIDERS.join(', ')}, got "${value}".`);
  }

  return value as LlmProvider;
}

export function roleIncludesGateway(role: AppRole): boolean {
  return role === 'all' || role === 'gateway';
}

export function roleIncludesWorker(role: AppRole): boolean {
  return role === 'all' || role === 'worker';
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * A PEM has newlines, which most secret stores and .env files cannot carry
 * literally, so accept either a path or a value with escaped newlines.
 */
function loadPrivateKey(): string | undefined {
  const path = process.env.GITHUB_PRIVATE_KEY_PATH;
  if (path) {
    return readFileSync(path, 'utf8');
  }

  return process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, '\n');
}

export function configuration(): Configuration {
  const llmProvider = resolveLlmProvider(process.env.LLM_PROVIDER);
  const llmKeyEnv = LLM_API_KEY_ENV[llmProvider];

  return {
    appRole: resolveAppRole(process.env.APP_ROLE),
    worker: {
      // One sandbox is a 2GB container. Extra worker processes are the
      // other way to add parallelism; this only raises concurrency inside one.
      concurrency: Math.max(1, Math.floor(positiveNumber(process.env.WORKER_CONCURRENCY, 1))),
    },
    apiMonitor: {
      enabled: process.env.API_MONITOR_ENABLED !== 'false',
      // Providers announce retirements months ahead, so a few hours is plenty.
      intervalMs: positiveNumber(process.env.API_MONITOR_INTERVAL_MS, 6 * 60 * 60 * 1000),
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: positiveNumber(process.env.REDIS_PORT, 6379),
    },
    github: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: loadPrivateKey(),
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
      token: process.env.GITHUB_TOKEN,
      apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    },
    migrationsApiToken: process.env.MIGRATIONS_API_TOKEN,
    sandbox: {
      image: process.env.SANDBOX_IMAGE ?? 'synclab-sandbox:latest',
      timeoutMs: positiveNumber(process.env.SANDBOX_TIMEOUT_MS, 10 * 60 * 1000),
      memoryBytes: positiveNumber(process.env.SANDBOX_MEMORY_MB, 2048) * MEGABYTE,
      nanoCpus: Math.round(positiveNumber(process.env.SANDBOX_CPUS, 1) * 1e9),
      pidsLimit: positiveNumber(process.env.SANDBOX_PIDS_LIMIT, 512),
      dockerSocketPath: process.env.DOCKER_SOCKET_PATH,
    },
    llm: {
      provider: llmProvider,
      apiKey: llmKeyEnv ? (process.env[llmKeyEnv] ?? '') : '',
      // The sandbox container reaches Ollama on the host, so this is the
      // host as Docker Desktop exposes it, not localhost.
      baseUrl: process.env.LLM_BASE_URL ?? 'http://host.docker.internal:11434',
      numCtx: positiveNumber(process.env.LLM_NUM_CTX, 32_768),
      model: process.env.LLM_MODEL ?? DEFAULT_LLM_MODELS[llmProvider],
      // Every attempt is a fresh round of LLM calls, so the ceilings are
      // deliberately low: they are the only brake on the cost of one job.
      maxAttempts: positiveNumber(process.env.LLM_MAX_ATTEMPTS, 3),
      maxFiles: positiveNumber(process.env.LLM_MAX_FILES, 20),
      maxFileBytes: positiveNumber(process.env.LLM_MAX_FILE_BYTES, 60_000),
    },
  };
}
