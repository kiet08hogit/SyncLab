import { NextResponse, type NextRequest } from "next/server";

// Old links to the dashboard's filters used to live at /. A signed-in user can
// stay on the home page; the dashboard links back here.
export function proxy(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const dashboardLink = ["status", "repo", "q"].some((key) => searchParams.has(key));
  if (!dashboardLink) return;
  const url = request.nextUrl.clone();
  url.pathname = "/dashboard";
  return NextResponse.redirect(url);
}

export const config = { matcher: "/" };
