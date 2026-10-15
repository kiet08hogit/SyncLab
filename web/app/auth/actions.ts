"use server";

import { redirect } from "next/navigation";

import { clearSession } from "@/lib/session";

export async function signOut() {
  await clearSession();
  redirect("/settings");
}
