import { describe, expect, it } from "vitest";

import { formatClock, formatDate, formatDuration, splitExitCode, tailLines, timeAgo } from "@/lib/format";

describe("splitExitCode", () => {
  it("splits the exit code off the first line", () => {
    expect(splitExitCode("[exit 0]\nadded 12 packages")).toEqual({ exitCode: 0, body: "added 12 packages" });
  });

  it("reads non-zero and negative exit codes", () => {
    expect(splitExitCode("[exit 1]\nnpm ERR!")).toEqual({ exitCode: 1, body: "npm ERR!" });
    expect(splitExitCode("[exit -1]\nkilled")).toEqual({ exitCode: -1, body: "killed" });
  });

  it("allows a prefix with no output after it", () => {
    expect(splitExitCode("[exit 0]")).toEqual({ exitCode: 0, body: "" });
  });

  it("leaves output without a prefix alone", () => {
    expect(splitExitCode("Starting migration for acme/web")).toEqual({
      exitCode: null,
      body: "Starting migration for acme/web",
    });
  });

  it("only matches the prefix at the start", () => {
    expect(splitExitCode("log\n[exit 2]\nmore")).toEqual({ exitCode: null, body: "log\n[exit 2]\nmore" });
  });

  it("treats a missing output as empty", () => {
    expect(splitExitCode(null)).toEqual({ exitCode: null, body: "" });
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");

  it("says just now under a minute", () => {
    expect(timeAgo("2026-10-15T11:59:30Z", now)).toBe("just now");
  });

  it("uses the largest whole unit", () => {
    expect(timeAgo("2026-10-15T11:55:00Z", now)).toBe("5 minutes ago");
    expect(timeAgo("2026-10-15T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-10-14T12:00:00Z", now)).toBe("yesterday");
    expect(timeAgo("2026-10-10T12:00:00Z", now)).toBe("5 days ago");
  });
});

describe("formatDate and formatClock", () => {
  it("formats in UTC so server and browser agree", () => {
    expect(formatDate("2026-10-15T09:05:00Z")).toBe("Oct 15, 2026, 9:05 AM UTC");
    expect(formatClock("2026-10-15T09:05:07.123Z")).toBe("09:05:07");
  });
});

describe("formatDuration", () => {
  it("picks units that fit the length", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_400)).toBe("45s");
    expect(formatDuration(252_000)).toBe("4m 12s");
    expect(formatDuration(3_780_000)).toBe("1h 3m");
  });

  it("never goes negative when clocks disagree", () => {
    expect(formatDuration(-2_000)).toBe("0s");
  });
});

describe("tailLines", () => {
  it("keeps short output whole", () => {
    expect(tailLines("a\nb", 5)).toEqual({ hidden: 0, text: "a\nb" });
  });

  it("keeps the last lines and counts the rest", () => {
    expect(tailLines("1\n2\n3\n4\n5", 2)).toEqual({ hidden: 3, text: "4\n5" });
  });
});
