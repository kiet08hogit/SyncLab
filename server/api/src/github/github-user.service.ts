import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Configuration } from '../config/configuration';

const PAGE_SIZE = 100;
// Long enough that one dashboard page load (several API calls) resolves
// access once, short enough that a revoked installation stops working soon.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1_000;

export interface AccessibleRepository {
  githubRepoId: bigint;
  fullName: string;
  installationId: bigint;
  private: boolean;
}

export interface GithubUser {
  login: string;
  /** Keyed by GitHub repository id, which survives renames and transfers. */
  repositories: Map<bigint, AccessibleRepository>;
}

interface CacheEntry {
  expiresAt: number;
  user: Promise<GithubUser>;
}

/**
 * Resolves a GitHub App user access token to the user and every repository
 * they can reach through an installation of the App. GitHub only returns
 * installations and repositories that both the user and the App can access,
 * so this is the same boundary the dashboard shows.
 */
@Injectable()
export class GithubUserService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly config: ConfigService<Configuration, true>) {}

  resolve(token: string): Promise<GithubUser> {
    // Keyed by a digest so the cache never holds a usable token.
    const key = createHash('sha256').update(token).digest('hex');
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.user;
    }

    const user = this.load(token);
    this.remember(key, { expiresAt: now + CACHE_TTL_MS, user });
    // A failed lookup must not be served from the cache to the next request.
    user.catch(() => this.cache.delete(key));
    return user;
  }

  private remember(key: string, entry: CacheEntry) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const now = Date.now();
      for (const [cachedKey, cached] of this.cache) {
        if (cached.expiresAt <= now) this.cache.delete(cachedKey);
      }
      // Still full of live entries: drop the oldest, which Map keeps first.
      if (this.cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
    }
    this.cache.set(key, entry);
  }

  private async load(token: string): Promise<GithubUser> {
    const { login } = await this.get<{ login: string }>(token, '/user');

    const installations = await this.paginate<{ id: number; suspended_at: string | null }>(
      token,
      '/user/installations',
      'installations',
    );

    const repositories = new Map<bigint, AccessibleRepository>();
    const lists = await Promise.all(
      installations
        .filter((installation) => !installation.suspended_at)
        .map(async (installation) => {
          const repos = await this.paginate<{ id: number; full_name: string; private: boolean }>(
            token,
            `/user/installations/${installation.id}/repositories`,
            'repositories',
          );
          return repos.map((repo) => ({
            githubRepoId: BigInt(repo.id),
            fullName: repo.full_name,
            installationId: BigInt(installation.id),
            private: repo.private,
          }));
        }),
    );
    for (const repo of lists.flat()) {
      repositories.set(repo.githubRepoId, repo);
    }

    return { login, repositories };
  }

  private async paginate<T>(token: string, path: string, key: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const body = await this.get<Record<string, T[]>>(
        token,
        `${path}?per_page=${PAGE_SIZE}&page=${page}`,
      );
      const batch = body[key] ?? [];
      items.push(...batch);
      if (batch.length < PAGE_SIZE) return items;
    }
  }

  private async get<T>(token: string, path: string): Promise<T> {
    const apiUrl = this.config.get('github', { infer: true }).apiUrl;
    const response = await fetch(`${apiUrl}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }).catch((error: unknown) => {
      throw new BadGatewayException('GitHub request failed', { cause: error });
    });

    // GitHub answers a rate limit with 403 too; the token is still valid then.
    if (
      response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))
    ) {
      throw new ServiceUnavailableException(
        'GitHub rate limit reached while checking access. Try again shortly.',
      );
    }
    // 401: revoked or expired. 403 on /user/installations: a token that is not
    // a GitHub App user token, such as a personal access token.
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException(
        'GitHub did not accept the token. Use a GitHub App user access token.',
      );
    }
    if (!response.ok) {
      throw new BadGatewayException(`GitHub GET ${path} failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
