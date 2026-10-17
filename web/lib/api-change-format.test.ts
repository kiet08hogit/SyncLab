import { describe, expect, it } from "vitest";

import { describeChange, effectiveCountdown, formatCalendarDate, shortUrl } from "@/lib/api-change-format";

const NOW = Date.parse("2026-10-17T15:30:00Z");

describe("effectiveCountdown", () => {
  it("counts whole calendar days from today in UTC, not from this hour", () => {
    expect(effectiveCountdown("2026-10-18", NOW)).toEqual({ label: "takes effect tomorrow", urgency: "soon" });
    expect(effectiveCountdown("2026-10-17", NOW)).toEqual({ label: "takes effect today", urgency: "soon" });
    expect(effectiveCountdown("2026-10-16", NOW)).toEqual({ label: "took effect yesterday", urgency: "passed" });
  });

  it("marks a change due within 30 days as soon, and anything later as later", () => {
    expect(effectiveCountdown("2026-11-16", NOW)).toEqual({ label: "in 30 days", urgency: "soon" });
    expect(effectiveCountdown("2026-11-17", NOW)).toEqual({ label: "in 31 days", urgency: "later" });
  });

  it("says how long ago a passed change took effect", () => {
    expect(effectiveCountdown("2026-10-01", NOW)).toEqual({ label: "took effect 16 days ago", urgency: "passed" });
  });
});

describe("describeChange", () => {
  const base = { operation: null, field: null, replacement: null, section: null };

  it("names the retired model and its replacement", () => {
    expect(
      describeChange({ ...base, kind: "model_retired", field: "claude-sonnet-4-5-20250929", replacement: "claude-sonnet-5-5" }),
    ).toEqual({ subject: "claude-sonnet-4-5-20250929", context: null, replacement: "claude-sonnet-5-5" });
  });

  it("names the removed endpoint as the subject", () => {
    expect(describeChange({ ...base, kind: "endpoint_removed", operation: "/v1/edits" })).toEqual({
      subject: "/v1/edits",
      context: null,
      replacement: null,
    });
  });

  it("names a parameter together with the endpoint it belongs to", () => {
    expect(
      describeChange({ ...base, kind: "param_removed", operation: "POST /v1/messages", field: "top_k" }),
    ).toEqual({ subject: "top_k", context: "POST /v1/messages", replacement: null });
  });

  it("falls back to the section heading, then to the kind, when the change names nothing", () => {
    expect(describeChange({ ...base, kind: "behavior_changed", section: "Streaming errors" }).subject).toBe(
      "Streaming errors",
    );
    expect(describeChange({ ...base, kind: "behavior_changed" }).subject).toBe("Behavior changed");
  });
});

describe("formatCalendarDate", () => {
  it("reads the date as the calendar day it names, in every time zone", () => {
    expect(formatCalendarDate("2026-11-30")).toBe("Nov 30, 2026");
  });
});

describe("shortUrl", () => {
  it("drops the scheme and a trailing slash", () => {
    expect(shortUrl("https://platform.openai.com/docs/deprecations/")).toBe("platform.openai.com/docs/deprecations");
  });

  it("returns anything that is not a URL as it is", () => {
    expect(shortUrl("not a url")).toBe("not a url");
  });
});
