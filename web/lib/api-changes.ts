import "server-only";

import { connection } from "next/server";
import { cache } from "react";

import { listApiChanges, listApiProviders, MonitorUnavailableError } from "@/lib/api";
import { getSession } from "@/lib/session";
import type { ApiChange, ApiChangeFilter, ApiProviderSummary, ApiSource } from "@/lib/types";

// The API change monitor, read with the signed-in user's token. Signed out,
// the getters serve the samples below, shaped exactly like the contract in
// infra/Architecture/05 - Self-Maintaining API.md. Signed in to an API that
// does not run the monitor yet, every monitor route answers 404, and the
// getters serve the samples too, saying so, rather than an empty page.

/**
 * Where a monitor view came from: the user's API, the samples because the
 * visitor is signed out, or the samples because the API has no monitor yet.
 */
export type MonitorSource = "live" | "sample" | "unavailable";

export interface MonitorView<T> {
  source: MonitorSource;
  data: T;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** A calendar date `days` from today in UTC, as `YYYY-MM-DD`. */
function inDays(days: number): string {
  return new Date(Math.floor(Date.now() / DAY) * DAY + days * DAY).toISOString().slice(0, 10);
}

const longDate = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

/** A deprecations table row, the way the parser quotes it as evidence. */
function tableRow(date: string, ...cells: string[]): string {
  return [longDate.format(Date.parse(`${date}T00:00:00Z`)), ...cells].join(" | ");
}

const ANTHROPIC_DEPRECATIONS = "https://platform.claude.com/docs/en/about-claude/model-deprecations";
const OPENAI_DEPRECATIONS = "https://developers.openai.com/api/docs/deprecations";

const SNAPSHOTS = {
  anthropic: { id: "6f1c2a90-4b7e-4d3a-9e15-8c2f0a7b3d41", contentHash: "9b2e41c7d05a", fetchedAt: ago(16 * DAY) },
  openai: { id: "a83d5f12-0c6b-4e9a-b2d7-41f6e8c09a52", contentHash: "4c7a09e3f18b", fetchedAt: ago(3 * DAY) },
};

interface ChangeSeed extends Omit<ApiChange, "source" | "snapshotId" | "detectedAt" | "updatedAt" | "evidence"> {
  detectedAgo: number;
  reviewedAgo?: number;
  evidence: string;
}

function sampleChangeSeeds(): ChangeSeed[] {
  const sonnet = inDays(44);
  const opus = inDays(12);
  const haiku = inDays(-16);
  const gpt = inDays(73);
  const edits = inDays(-120);
  const realtime = inDays(26);

  return [
    {
      id: "0d4a7c19-2e8b-4f60-a1d5-93c7e2b8f014",
      provider: "anthropic",
      kind: "model_retired",
      operation: null,
      field: "claude-sonnet-4-5-20250929",
      replacement: "claude-sonnet-5-5",
      effectiveAt: sonnet,
      section: "Claude Sonnet 4.5",
      evidence: tableRow(sonnet, "claude-sonnet-4-5-20250929", "claude-sonnet-5-5"),
      status: "confirmed",
      detectedAgo: 16 * DAY,
    },
    {
      id: "5b9e3f27-7d1a-4c84-b6e2-0f8a4d1c6e93",
      provider: "anthropic",
      kind: "model_retired",
      operation: null,
      field: "claude-opus-4-1-20250805",
      replacement: "claude-opus-5-5",
      effectiveAt: opus,
      section: "Claude Opus 4.1",
      evidence: tableRow(opus, "claude-opus-4-1-20250805", "claude-opus-5-5"),
      status: "confirmed",
      detectedAgo: 16 * DAY,
    },
    {
      id: "c2f8a61d-9e4b-4d07-8a3c-5b1e7f0d2c86",
      provider: "anthropic",
      kind: "model_retired",
      operation: null,
      field: "claude-3-5-haiku-20241022",
      replacement: "claude-haiku-4-5",
      effectiveAt: haiku,
      section: "Claude Haiku 3.5",
      evidence: tableRow(haiku, "claude-3-5-haiku-20241022", "claude-haiku-4-5"),
      status: "confirmed",
      detectedAgo: 70 * DAY,
    },
    {
      id: "e71b04c8-3a5f-4e29-9d6b-2c8f1a7e4b30",
      provider: "openai",
      kind: "model_retired",
      operation: null,
      field: "gpt-4.1-mini",
      replacement: "gpt-5-mini",
      effectiveAt: gpt,
      section: "GPT-4.1 mini",
      evidence: tableRow(gpt, "gpt-4.1-mini", "gpt-5-mini"),
      status: "detected",
      detectedAgo: 3 * DAY,
    },
    {
      id: "8a3c6e05-1f7d-4b92-a4e8-6d0b3c9f1a27",
      provider: "openai",
      kind: "endpoint_removed",
      operation: "/v1/realtime/sessions",
      field: null,
      replacement: "/v1/realtime/client_secrets",
      effectiveAt: realtime,
      section: "Realtime API beta",
      evidence: tableRow(realtime, "/v1/realtime/sessions", "/v1/realtime/client_secrets"),
      status: "detected",
      detectedAgo: 3 * DAY,
    },
    {
      id: "4f0d9b72-6c3e-4a18-b5f1-7e2a8c4d0b69",
      provider: "openai",
      kind: "endpoint_removed",
      operation: "/v1/edits",
      field: null,
      replacement: "/v1/chat/completions",
      effectiveAt: edits,
      section: "Edits API",
      evidence: tableRow(edits, "/v1/edits", "/v1/chat/completions"),
      status: "dismissed",
      detectedAgo: 3 * DAY,
      reviewedAgo: 2 * DAY,
    },
  ];
}

function sampleChanges(): ApiChange[] {
  return sampleChangeSeeds()
    .map(({ detectedAgo, reviewedAgo, ...seed }) => ({
      ...seed,
      source: {
        kind: "deprecations" as const,
        url: seed.provider === "anthropic" ? ANTHROPIC_DEPRECATIONS : OPENAI_DEPRECATIONS,
      },
      snapshotId: SNAPSHOTS[seed.provider].id,
      detectedAt: ago(detectedAgo),
      updatedAt: ago(reviewedAgo ?? detectedAgo),
    }))
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

function sampleProviders(): ApiProviderSummary[] {
  const changes = sampleChanges();
  const sources: Record<ApiProviderSummary["slug"], ApiSource[]> = {
    anthropic: [
      {
        kind: "deprecations",
        url: ANTHROPIC_DEPRECATIONS,
        lastCheckedAt: ago(42 * MINUTE),
        lastError: null,
        latestSnapshot: SNAPSHOTS.anthropic,
      },
    ],
    openai: [
      {
        kind: "deprecations",
        url: OPENAI_DEPRECATIONS,
        lastCheckedAt: ago(42 * MINUTE),
        // A source whose last fetch failed keeps its last good snapshot.
        lastError: "GET https://developers.openai.com/api/docs/deprecations answered 503 Service Unavailable",
        latestSnapshot: SNAPSHOTS.openai,
      },
    ],
  };

  return (["anthropic", "openai"] as const).map((slug) => {
    const own = changes.filter((change) => change.provider === slug);
    return {
      slug,
      sources: sources[slug],
      changeCounts: {
        detected: own.filter((change) => change.status === "detected").length,
        confirmed: own.filter((change) => change.status === "confirmed").length,
        dismissed: own.filter((change) => change.status === "dismissed").length,
      },
    };
  });
}

function filterChanges(changes: ApiChange[], filter: ApiChangeFilter): ApiChange[] {
  return changes.filter(
    (change) =>
      (!filter.provider || change.provider === filter.provider) &&
      (!filter.status || change.status === filter.status) &&
      (!filter.kind || change.kind === filter.kind),
  );
}

/** Reads the API when signed in, and falls back to the samples while it has no monitor. */
async function fromMonitor<T>(read: (token: string) => Promise<T>, samples: () => T): Promise<MonitorView<T>> {
  await connection();
  const session = await getSession();
  if (!session) return { source: "sample", data: samples() };

  try {
    return { source: "live", data: await read(session.accessToken) };
  } catch (error) {
    if (error instanceof MonitorUnavailableError) return { source: "unavailable", data: samples() };
    throw error;
  }
}

export const getApiProviders = cache(
  (): Promise<MonitorView<ApiProviderSummary[]>> => fromMonitor(listApiProviders, sampleProviders),
);

export async function getApiChanges(filter: ApiChangeFilter = {}): Promise<MonitorView<ApiChange[]>> {
  return fromMonitor(
    (token) => listApiChanges(token, filter),
    () => filterChanges(sampleChanges(), filter),
  );
}
