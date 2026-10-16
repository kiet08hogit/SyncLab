import { describe, expect, it } from "vitest";

import { safeReturnTo } from "@/lib/auth";

describe("safeReturnTo", () => {
  it("keeps same-origin paths with their query and hash", () => {
    expect(safeReturnTo("/migrations/new")).toBe("/migrations/new");
    expect(safeReturnTo("/?status=FAILED&repo=acme%2Fweb#jobs")).toBe("/?status=FAILED&repo=acme%2Fweb#jobs");
  });

  it("falls back to settings when there is nothing to return to", () => {
    expect(safeReturnTo(null)).toBe("/settings");
    expect(safeReturnTo(undefined)).toBe("/settings");
    expect(safeReturnTo("")).toBe("/settings");
  });

  it.each([
    ["an absolute URL", "https://evil.example/phish"],
    ["a protocol-relative URL", "//evil.example/phish"],
    ["a backslash the browser treats as a slash", "/\\evil.example"],
    ["a relative path", "settings"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a tab inside the slashes", "/\t/evil.example"],
    ["a newline inside the slashes", "/\n/evil.example"],
  ])("rejects %s", (_, value) => {
    expect(safeReturnTo(value)).toBe("/settings");
  });
});
