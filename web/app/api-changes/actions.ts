"use server";

import { refresh } from "next/cache";

import { ApiUnauthorizedError, MonitorUnavailableError, pollApiProviders } from "@/lib/api";
import { getSession } from "@/lib/session";

export interface PollState {
  error: string | null;
  /** When the poll was queued, so the page can tell when every source has been checked since. */
  requestedAt: string | null;
}

/** Asks the monitor to fetch every watched source now instead of waiting for its schedule. */
export async function pollSources(): Promise<PollState> {
  const session = await getSession();
  if (!session) return { error: "Sign in with GitHub to check the providers.", requestedAt: null };

  const requestedAt = new Date().toISOString();
  try {
    await pollApiProviders(session.accessToken);
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) {
      return { error: "Your GitHub session expired. Sign in again to check the providers.", requestedAt: null };
    }
    if (error instanceof MonitorUnavailableError) {
      return { error: "The SyncLab API you are connected to does not run the change monitor yet.", requestedAt: null };
    }
    return { error: "The SyncLab API could not be reached. Check that the gateway is running.", requestedAt: null };
  }

  refresh();
  return { error: null, requestedAt };
}
