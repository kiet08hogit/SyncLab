import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { isValidBearerToken, MigrationsApiTokenGuard } from './migrations-api-token.guard';

const TOKEN = 'a-test-migrations-token';

describe('isValidBearerToken', () => {
  it('accepts the configured token', () => {
    expect(isValidBearerToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it('rejects a different token', () => {
    expect(isValidBearerToken('Bearer wrong-token', TOKEN)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(isValidBearerToken(undefined, TOKEN)).toBe(false);
  });

  it('rejects a header without the Bearer scheme', () => {
    expect(isValidBearerToken(TOKEN, TOKEN)).toBe(false);
    expect(isValidBearerToken(`Basic ${TOKEN}`, TOKEN)).toBe(false);
  });

  it('rejects a token of the wrong length without throwing', () => {
    expect(() => isValidBearerToken('Bearer abc', TOKEN)).not.toThrow();
    expect(isValidBearerToken('Bearer abc', TOKEN)).toBe(false);
  });

  it('rejects everything when no token is configured', () => {
    expect(isValidBearerToken('Bearer ', '')).toBe(false);
  });
});

describe('MigrationsApiTokenGuard', () => {
  function canActivate(configured: string, authorization?: string) {
    const config = { get: () => configured };
    const request = {
      header: (name: string) => (name === 'authorization' ? authorization : undefined),
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) };
    return new MigrationsApiTokenGuard(config as never).canActivate(context as never);
  }

  it('lets a request with the configured bearer token through', () => {
    expect(canActivate(TOKEN, `Bearer ${TOKEN}`)).toBe(true);
  });

  it('rejects a wrong or missing token as unauthorized', () => {
    expect(() => canActivate(TOKEN, 'Bearer wrong-token')).toThrow(UnauthorizedException);
    expect(() => canActivate(TOKEN)).toThrow(UnauthorizedException);
  });

  it('disables the endpoint with a server error when no token is configured', () => {
    expect(() => canActivate('', 'Bearer ')).toThrow(InternalServerErrorException);
  });
});
