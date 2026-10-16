import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Configuration } from '../config/configuration';
import { GithubUserService, type AccessibleRepository } from '../github/github-user.service';

const BEARER_PREFIX = 'Bearer ';

/**
 * Who is calling. A service caller holds MIGRATIONS_API_TOKEN and may act on
 * any repository; a user caller sent their own GitHub App user access token
 * and may only act on repositories their installations reach.
 */
export type Caller =
  | { kind: 'service' }
  | { kind: 'user'; login: string; repositories: Map<bigint, AccessibleRepository> };

type AuthedRequest = Request & { caller?: Caller };

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Exported for testing. Hashing both sides gives equal-length buffers, so the
 * comparison runs in constant time and does not leak the token's length.
 */
export function isValidBearerToken(authorization: string | undefined, expected: string): boolean {
  if (!expected || !authorization?.startsWith(BEARER_PREFIX)) {
    return false;
  }

  const received = authorization.slice(BEARER_PREFIX.length);
  return timingSafeEqual(sha256(received), sha256(expected));
}

@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<Configuration, true>,
    private readonly githubUsers: GithubUserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const authorization = request.header('authorization');

    if (
      isValidBearerToken(
        authorization,
        this.config.get('migrationsApiToken', { infer: true }) ?? '',
      )
    ) {
      request.caller = { kind: 'service' };
      return true;
    }

    const token = authorization?.startsWith(BEARER_PREFIX)
      ? authorization.slice(BEARER_PREFIX.length).trim()
      : '';
    if (!token) {
      throw new UnauthorizedException(
        'Send a GitHub App user access token, or MIGRATIONS_API_TOKEN, as a bearer token',
      );
    }

    const user = await this.githubUsers.resolve(token);
    request.caller = { kind: 'user', login: user.login, repositories: user.repositories };
    return true;
  }
}

/** The caller ApiAuthGuard attached to the request. */
export const CurrentCaller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Caller => {
    const caller = context.switchToHttp().getRequest<AuthedRequest>().caller;
    if (!caller) {
      throw new UnauthorizedException('Request was not authenticated');
    }
    return caller;
  },
);
