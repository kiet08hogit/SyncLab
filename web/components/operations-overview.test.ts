import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperationsOverview } from "@/components/operations-overview";
import type { OperationsSnapshot } from "@/lib/operations-types";

function snapshot(queue: { paused?: boolean; failed?: number }, sandboxFailed = 0): OperationsSnapshot {
  return {
    collectedAt: "2026-11-23T00:00:00.000Z",
    queues: [
      {
        name: "migration-queue",
        waiting: 0,
        active: 0,
        delayed: 0,
        failed: queue.failed ?? 0,
        pausedJobs: 0,
        waitingChildren: 0,
        paused: queue.paused ?? false,
      },
    ],
    sandbox: { count: 4, failed: sandboxFailed, totalSeconds: 2, buckets: [] },
    tokens: { input: 0, output: 0 },
  };
}

function render(queue: { paused?: boolean; failed?: number }, sandboxFailed = 0): string {
  return renderToStaticMarkup(
    createElement(OperationsOverview, { snapshot: snapshot(queue, sandboxFailed) }),
  );
}

describe("operations attention banner", () => {
  it("stays clear when the only failures are historical sandbox creations", () => {
    const html = render({}, 3);
    expect(html).toContain("Queues accepting work");
    expect(html).not.toContain("Review paused queues and recorded failures");
    expect(html).toContain("Creation failures");
    expect(html).toContain(">3<");
  });

  it("warns when a queue is paused even if sandbox creation has not failed", () => {
    const html = render({ paused: true }, 0);
    expect(html).toContain("Review paused queues and recorded failures");
    expect(html).not.toContain("Queues accepting work");
  });

  it("warns when a queue still retains failed jobs", () => {
    const html = render({ failed: 2 }, 0);
    expect(html).toContain("Review paused queues and recorded failures");
    expect(html).not.toContain("Queues accepting work");
  });
});
