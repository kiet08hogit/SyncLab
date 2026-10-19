"use server";

import { redirect } from "next/navigation";

import { safeReturnTo } from "@/lib/auth";
import { clearSession } from "@/lib/session";

export async function signOut(formData?: FormData) {
  await clearSession();
  const requested = formData instanceof FormData ? formData.get("returnTo") : null;
  redirect(safeReturnTo(typeof requested === "string" ? requested : null));
}
