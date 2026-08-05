import { readFileSync } from 'node:fs';

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

export interface LlmConfig {
  apiKey: string;
  model: string;
  maxAttempts: number;
  maxFiles: number;
  maxFileBytes: number;
}

export interface Configuration {
  redis: RedisConfig;
  github: GithubConfig;
  sandbox: SandboxConfig;
  llm: LlmConfig;
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
  return {
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
    sandbox: {
      image: process.env.SANDBOX_IMAGE ?? 'synclab-sandbox:latest',
      timeoutMs: positiveNumber(process.env.SANDBOX_TIMEOUT_MS, 10 * 60 * 1000),
      memoryBytes: positiveNumber(process.env.SANDBOX_MEMORY_MB, 2048) * MEGABYTE,
      nanoCpus: Math.round(positiveNumber(process.env.SANDBOX_CPUS, 1) * 1e9),
      pidsLimit: positiveNumber(process.env.SANDBOX_PIDS_LIMIT, 512),
      dockerSocketPath: process.env.DOCKER_SOCKET_PATH,
    },
    llm: {
      apiKey: process.env.GEMINI_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? 'gemini-3.1-pro-preview',
      // Every attempt is a fresh round of LLM calls, so the ceilings are
      // deliberately low: they are the only brake on the cost of one job.
      maxAttempts: positiveNumber(process.env.LLM_MAX_ATTEMPTS, 3),
      maxFiles: positiveNumber(process.env.LLM_MAX_FILES, 20),
      maxFileBytes: positiveNumber(process.env.LLM_MAX_FILE_BYTES, 60_000),
    },
  };
}
