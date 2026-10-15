import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { GithubSignatureGuard, isValidSignature, SIGNATURE_HEADER } from './github-signature.guard';

const SECRET = 'a-test-webhook-secret';
const BODY = Buffer.from(JSON.stringify({ action: 'published' }), 'utf8');

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('isValidSignature', () => {
  it('accepts a signature produced with the configured secret', () => {
    expect(isValidSignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it('rejects a signature produced with a different secret', () => {
    expect(isValidSignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toBe(false);
  });

  it('rejects a signature that does not cover the received body', () => {
    const tampered = Buffer.from(JSON.stringify({ action: 'deleted' }), 'utf8');
    expect(isValidSignature(tampered, sign(BODY, SECRET), SECRET)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(isValidSignature(BODY, undefined, SECRET)).toBe(false);
  });

  it('rejects a missing raw body', () => {
    expect(isValidSignature(undefined, sign(BODY, SECRET), SECRET)).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(() => isValidSignature(BODY, 'sha256=abc', SECRET)).not.toThrow();
    expect(isValidSignature(BODY, 'sha256=abc', SECRET)).toBe(false);
  });
});

describe('GithubSignatureGuard', () => {
  function canActivate(secret: string, rawBody: Buffer | undefined, signature?: string) {
    const config = { get: () => ({ webhookSecret: secret }) };
    const request = {
      rawBody,
      header: (name: string) => (name === SIGNATURE_HEADER ? signature : undefined),
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) };
    return new GithubSignatureGuard(config as never).canActivate(context as never);
  }

  it('lets a correctly signed delivery through', () => {
    expect(canActivate(SECRET, BODY, sign(BODY, SECRET))).toBe(true);
  });

  it('rejects a delivery with a bad signature as unauthorized', () => {
    expect(() => canActivate(SECRET, BODY, sign(BODY, 'wrong-secret'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an unsigned delivery as unauthorized', () => {
    expect(() => canActivate(SECRET, BODY)).toThrow(UnauthorizedException);
  });

  it('fails closed with a server error when no webhook secret is configured', () => {
    // A signature made with an empty secret must not be accepted either.
    expect(() => canActivate('', BODY, sign(BODY, ''))).toThrow(InternalServerErrorException);
  });
});
