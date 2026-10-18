"use server";

import { refresh } from "next/cache";

import { ApiUnauthorizedError, MonitorUnavailableError, pollApiProviders, reviewApiChange } from "@/lib/api";
import { getSession } from "@/lib/session";
import type { ApiChangeDecision } from "@/lib/types";

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

export interface ReviewState {
  error: string | null;
}

const REVIEW_SESSION_EXPIRED = "Your GitHub session expired. Sign in again to review this change.";

/**
 * Confirms or dismisses a breaking change. Every installation sees the result,
 * so the API lets only monitor admins do it. A refused or vanished change also
 * refreshes the page, so its buttons and status match the API again.
 */
export async function reviewChange(id: string, decision: ApiChangeDecision): Promise<ReviewState> {
  if (decision !== "confirm" && decision !== "dismiss") return { error: "Unknown review decision." };
  const session = await getSession();
  if (!session) return { error: REVIEW_SESSION_EXPIRED };

  try {
    const result = await reviewApiChange(session.accessToken, id, decision);
    if (!result.ok) {
      if (result.status === 403) {
        refresh();
        return { error: "Only monitor admins can confirm or dismiss changes." };
      }
      if (result.status === 404) {
        refresh();
        return { error: "This change no longer exists." };
      }
      return { error: result.error };
    }
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return { error: REVIEW_SESSION_EXPIRED };
    return { error: "The SyncLab API could not be reached. Check that the gateway is running." };
  }

  refresh();
  return { error: null };
}
