import { NextResponse, type NextRequest } from "next/server";

import { readSession, SESSION_COOKIE } from "@/lib/session";

// The landing page at / is for visitors. A signed-in user goes straight to the
// dashboard, and so does an old link to the dashboard's filters, which used to
// live at / too.
export function proxy(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const dashboardLink = ["status", "repo", "q"].some((key) => searchParams.has(key));
  if (dashboardLink || readSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
}

export const config = { matcher: "/" };
