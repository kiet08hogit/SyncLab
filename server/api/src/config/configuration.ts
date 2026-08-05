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
  codemodSearch: string;
  codemodReplace: string;
  dockerSocketPath?: string;
}

export interface Configuration {
  redis: RedisConfig;
  github: GithubConfig;
  sandbox: SandboxConfig;
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
      codemodSearch: process.env.SANDBOX_CODEMOD_SEARCH ?? 'DEPRECATED_API',
      codemodReplace: process.env.SANDBOX_CODEMOD_REPLACE ?? 'MODERN_API',
      dockerSocketPath: process.env.DOCKER_SOCKET_PATH,
    },
  };
}
