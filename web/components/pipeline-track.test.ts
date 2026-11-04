import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PipelineTrack } from "@/components/pipeline-track";
import type { LogStep } from "@/lib/types";

/**
 * The job page mounts this track for an API-change job. Rendering it is the
 * page's pipeline: a missing status binding throws before any stage is drawn.
 */
function renderJobPipeline(props: {
  steps: LogStep[];
  status: "FAILED" | "IN_PROGRESS";
  kind: "api_change";
  dependencyName: string | null;
  targetVersion: string | null;
}) {
  return renderToStaticMarkup(createElement(PipelineTrack, props));
}

function listItems(html: string): string[] {
  return [...html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map((item) =>
    item[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

describe("job page pipeline for an SDK upgrade", () => {
  const failedUpgrade: LogStep[] = ["STARTED", "CLONE", "CHANGELOG", "INSTALL", "BASELINE", "UPGRADE", "FAILED"];

  it("shows Changelog and Upgrade and says the upgrade failed", () => {
    const html = renderJobPipeline({
      steps: failedUpgrade,
      status: "FAILED",
      kind: "api_change",
      dependencyName: "@anthropic-ai/sdk",
      targetVersion: "1.3.0",
    });
    const items = listItems(html);
    const caption = html.match(/<p\b[^>]*>([^<]*)<\/p>/)?.[1]?.trim();

    expect(html).toContain('aria-label="Failed at upgrade (stage 5 of 8)"');
    expect(caption).toBe("Failed at upgrade (stage 5 of 8)");
    expect(items).toHaveLength(8);
    expect(items.map((item) => /Changelog|Upgrade|Clone|Install|Baseline|Refactor|Test|Pull request/.exec(item)?.[0])).toEqual([
      "Clone",
      "Changelog",
      "Install",
      "Baseline",
      "Upgrade",
      "Refactor",
      "Test",
      "Pull request",
    ]);
    expect(items[1]).toContain("Passed");
    expect(items[4]).toContain("Failed");
  });
});
