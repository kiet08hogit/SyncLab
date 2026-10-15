import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";

// The GitHub user token lives in an encrypted, httpOnly cookie, so the browser
// can neither read it nor forge a session without SESSION_SECRET.

const COOKIE = "synclab_session";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface Session {
  accessToken: string;
  /** Epoch milliseconds. GitHub App user tokens expire after eight hours by default. */
  expiresAt: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

function key(): Buffer | null {
  const secret = process.env.SESSION_SECRET;
  return secret ? createHash("sha256").update(secret).digest() : null;
}

export function sessionConfigured(): boolean {
  return key() !== null;
}

export function seal(value: unknown): string {
  const secret = key();
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal<T>(sealed: string): T | null {
  const secret = key();
  if (!secret) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", secret, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const body = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    // Tampered, truncated, or sealed with a rotated secret: treat as signed out.
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  // The expiry check reads the clock, which has to happen at request time.
  await connection();
  const value = (await cookies()).get(COOKIE)?.value;
  const session = value ? unseal<Session>(value) : null;
  return session && session.expiresAt > Date.now() ? session : null;
}

/** Arguments for `response.cookies.set`, so the sign-in redirect carries the session itself. */
export function sessionCookie(session: Session) {
  return [
    COOKIE,
    seal(session),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(session.expiresAt),
    },
  ] as const;
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
