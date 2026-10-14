import { isValidBearerToken } from './migrations-api-token.guard';

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
