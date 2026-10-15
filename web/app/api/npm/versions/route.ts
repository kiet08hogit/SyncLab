import type { NextRequest } from "next/server";

import { getVersions, isPackageName } from "@/lib/npm";
import { getSession } from "@/lib/session";

/** Stable versions of an npm package, for the new-migration form. */
export async function GET(request: NextRequest) {
  // Signed-in only, so the dashboard is not an open proxy to the registry.
  if (!(await getSession())) return Response.json({ error: "Sign in with GitHub first" }, { status: 401 });

  const name = request.nextUrl.searchParams.get("name") ?? "";
  if (!isPackageName(name)) return Response.json({ error: "Not a valid npm package name" }, { status: 400 });

  const result = await getVersions(name);
  if (!result) return Response.json({ error: `${name} is not published on npm` }, { status: 404 });
  return Response.json(result);
}
