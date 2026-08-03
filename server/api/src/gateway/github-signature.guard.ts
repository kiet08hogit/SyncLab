import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Configuration } from '../config/configuration';

export const SIGNATURE_HEADER = 'x-hub-signature-256';

/**
 * Exported for testing. Compares in constant time so a caller cannot learn the
 * expected digest one byte at a time.
 */
export function isValidSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!rawBody || !signature) {
    return false;
  }

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');

  // timingSafeEqual throws on a length mismatch, so screen for it first.
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

@Injectable()
export class GithubSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Configuration, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get('github', { infer: true }).webhookSecret;

    if (!secret) {
      throw new InternalServerErrorException(
        'GITHUB_WEBHOOK_SECRET is not configured, so webhook payloads cannot be verified',
      );
    }

    const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const signature = request.header(SIGNATURE_HEADER);

    if (!isValidSignature(request.rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid or missing GitHub webhook signature');
    }

    return true;
  }
}
