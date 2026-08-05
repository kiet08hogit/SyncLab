import { createHmac } from 'node:crypto';
import { isValidSignature } from './github-signature.guard';

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
