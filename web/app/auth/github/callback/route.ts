import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { safeReturnTo, STATE_COOKIE } from "@/lib/auth";
import { exchangeCode, getUser, githubAppConfig } from "@/lib/github";
import { sessionCookie, unseal, type Session } from "@/lib/session";

// GitHub App user tokens last eight hours; a token without an expiry gets the same lifetime here.
const DEFAULT_LIFETIME_SECONDS = 8 * 60 * 60;

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = unseal<{ state: string; returnTo: string }>(request.cookies.get(STATE_COOKIE)?.value ?? "");
  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/settings?error=${reason}`, request.url));
    response.cookies.delete({ name: STATE_COOKIE, path: "/auth/github" });
    return response;
  };

  const config = githubAppConfig();
  if (!config) return fail("not-configured");
  // The user pressed Cancel on GitHub's consent screen.
  if (params.get("error") === "access_denied") return fail("denied");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !saved || !sameState(state, saved.state)) return fail("state");

  let session: Session;
  try {
    const token = await exchangeCode(config, code, new URL("/auth/github/callback", request.url).toString());
    const user = await getUser(token.accessToken);
    session = {
      accessToken: token.accessToken,
      expiresAt: Date.now() + (token.expiresIn ?? DEFAULT_LIFETIME_SECONDS) * 1000,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
    };
  } catch (error) {
    console.error("GitHub sign-in failed", error);
    return fail("github");
  }

  const response = NextResponse.redirect(new URL(safeReturnTo(saved.returnTo), request.url));
  response.cookies.delete({ name: STATE_COOKIE, path: "/auth/github" });
  response.cookies.set(...sessionCookie(session));
  return response;
}
