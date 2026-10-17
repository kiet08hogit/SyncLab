import type { ApiChange, ApiChangeKind, ApiProvider, ApiSourceKind } from "@/lib/types";

export const PROVIDER_LABEL: Record<ApiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export const SOURCE_LABEL: Record<ApiSourceKind, string> = {
  deprecations: "Model deprecations",
  spec: "OpenAPI spec",
  release_notes: "API release notes",
  sdk_changelog: "SDK changelog",
};

export const KIND_LABEL: Record<ApiChangeKind, string> = {
  model_retired: "Model retired",
  param_removed: "Parameter removed",
  param_renamed: "Parameter renamed",
  param_now_required: "Parameter required",
  enum_value_removed: "Value removed",
  endpoint_removed: "Endpoint removed",
  behavior_changed: "Behavior changed",
};

/**
 * What changed, in the terms the change itself names: the model or parameter
 * in `field`, the endpoint in `operation`, and what replaces it. A kind that
 * names nothing falls back to the heading it was read under.
 */
export function describeChange(change: Pick<ApiChange, "kind" | "operation" | "field" | "replacement" | "section">): {
  subject: string;
  context: string | null;
  replacement: string | null;
} {
  const subject = change.field ?? change.operation ?? change.section ?? KIND_LABEL[change.kind];
  // An endpoint removal names the endpoint as its subject; a parameter change
  // names the parameter and says which endpoint it belongs to.
  const context = change.field && change.operation ? change.operation : null;
  return { subject, context, replacement: change.replacement };
}

const DAY = 86_400_000;

/** `YYYY-MM-DD` as midnight UTC, the way the API means it. */
function parseDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function startOfToday(now: number): number {
  return Math.floor(now / DAY) * DAY;
}

const calendar = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export function formatCalendarDate(date: string): string {
  return calendar.format(parseDate(date));
}

export type Urgency = "passed" | "soon" | "later";

/** Within this many days a change is due soon enough to fix first. */
export const SOON_DAYS = 30;

/**
 * How far off a change's effective date is, counted in whole calendar days
 * from today in UTC, so a date never reads as "in 0 days".
 */
export function effectiveCountdown(date: string, now = Date.now()): { label: string; urgency: Urgency } {
  const days = Math.round((parseDate(date) - startOfToday(now)) / DAY);
  if (days < 0) return { label: days === -1 ? "took effect yesterday" : `took effect ${-days} days ago`, urgency: "passed" };
  if (days === 0) return { label: "takes effect today", urgency: "soon" };
  if (days === 1) return { label: "takes effect tomorrow", urgency: "soon" };
  return { label: `in ${days} days`, urgency: days <= SOON_DAYS ? "soon" : "later" };
}

/** The page's host and path, short enough for a table cell. */
export function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}
