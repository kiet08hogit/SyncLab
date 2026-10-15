import "server-only";

import { githubAppConfig } from "@/lib/github";
import { sessionConfigured } from "@/lib/session";

export const STATE_COOKIE = "synclab_oauth_state";

/** Sign-in needs the App's OAuth credentials and a key for the session cookie. */
export function signInConfigured(): boolean {
  return githubAppConfig() !== null && sessionConfigured();
}

/** Only same-origin paths, so the sign-in round trip cannot be turned into an open redirect. */
export function safeReturnTo(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/settings";
}
