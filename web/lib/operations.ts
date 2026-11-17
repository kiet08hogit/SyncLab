import "server-only";
import { getSession } from "@/lib/session";
import { ApiUnauthorizedError } from "@/lib/api";
import type { OperationsSnapshot } from "@/lib/operations-types";

export type OperationsResult =
  | { status: "signed-out" | "forbidden" | "unavailable" }
  | { status: "live"; snapshot: OperationsSnapshot };

export async function getOperations(): Promise<OperationsResult> {
  const session = await getSession();
  if (!session) return { status: "signed-out" };
  const response = await fetch(`${process.env.SYNCLAB_API_URL ?? "http://localhost:3000"}/operations`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (response?.status === 401) throw new ApiUnauthorizedError("Sign in again to view operations.");
  if (response?.status === 403) return { status: "forbidden" };
  if (!response?.ok) return { status: "unavailable" };
  return { status: "live", snapshot: await response.json() as OperationsSnapshot };
}
