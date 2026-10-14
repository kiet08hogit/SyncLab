import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Configuration } from '../config/configuration';

const BEARER_PREFIX = 'Bearer ';

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
export class MigrationsApiTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Configuration, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const token = this.config.get('migrationsApiToken', { infer: true });

    if (!token) {
      throw new InternalServerErrorException(
        'MIGRATIONS_API_TOKEN is not configured, so manual migration requests are disabled',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (!isValidBearerToken(request.header('authorization'), token)) {
      throw new UnauthorizedException('Invalid or missing bearer token');
    }

    return true;
  }
}
