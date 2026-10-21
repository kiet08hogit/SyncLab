import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  connection: async () => {},
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { getJobs } from "@/lib/data";
import { describePipeline, pipelineStages } from "@/lib/pipeline";
import { PIPELINE_STAGES, type JobStatus, type LogStep, type PipelineStage } from "@/lib/types";

function attemptStages(steps: LogStep[], status: JobStatus): PipelineStage[] {
  const rows = status === "FAILED" && steps.at(-1) === "FAILED" ? steps.slice(0, -1) : steps;
  const boundary = Math.max(rows.lastIndexOf("STARTED"), rows.lastIndexOf("FAILED"));
  return rows
    .slice(boundary + 1)
    .filter((step): step is PipelineStage => (PIPELINE_STAGES as readonly string[]).includes(step));
}

describe("sample migrations", () => {
  it("draws each job only through a contiguous prefix of stages it logged", async () => {
    const jobs = await getJobs();
    const preview = jobs.filter((job) => job.status === "IN_PROGRESS").slice(0, 2);
    expect(preview.map((job) => [job.dependencyName, job.targetVersion])).toEqual([
      ["express", "v5.1.0"],
      ["claude-sonnet-4-5-20250929", "claude-sonnet-5-5"],
    ]);

    const api = preview[1]!;
    const ageMs = Date.now() - new Date(api.createdAt).getTime();
    expect(ageMs).toBeGreaterThan(3 * 60_000);
    expect(ageMs).toBeLessThan(5 * 60_000);
    expect(new Date(api.updatedAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(describePipeline(pipelineStages(api.steps, api.status), api.status)).toBe("Running install (stage 3 of 8)");

    for (const job of jobs) {
      const stages = attemptStages(job.steps, job.status);
      expect(
        stages.map((stage) => PIPELINE_STAGES.indexOf(stage)),
        job.id,
      ).toEqual(stages.map((_, index) => index));
      if (job.status === "COMPLETED") expect(stages, job.id).toEqual([...PIPELINE_STAGES]);
    }
  });
});
