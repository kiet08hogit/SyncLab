import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { safeReturnTo, signInConfigured, STATE_COOKIE } from "@/lib/auth";
import { GITHUB_URL, githubAppConfig } from "@/lib/github";
import { seal } from "@/lib/session";

/** Starts the GitHub App's web sign-in flow. */
export async function GET(request: NextRequest) {
  const config = githubAppConfig();
  if (!config || !signInConfigured()) {
    return NextResponse.redirect(new URL("/settings?error=not-configured", request.url));
  }

  const state = randomBytes(32).toString("base64url");
  const authorize = new URL(`${GITHUB_URL}/login/oauth/authorize`);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", new URL("/auth/github/callback", request.url).toString());
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(
    STATE_COOKIE,
    seal({ state, returnTo: safeReturnTo(request.nextUrl.searchParams.get("returnTo")) }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth/github",
      maxAge: 600,
    },
  );
  return response;
}
