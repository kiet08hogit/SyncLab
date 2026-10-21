import { describe, expect, it } from "vitest";

import { jobBranch, jobTitle } from "@/lib/jobs";
import type { MigrationChange, MigrationJob } from "@/lib/types";

const change: MigrationChange = {
  id: "3f2a9c1e-0000-4000-8000-000000000000",
  provider: "openai",
  kind: "model_retired",
  operation: "chat.completions",
  field: "gpt-4-0613",
  replacement: "gpt-4.1",
  effectiveAt: "2026-12-01",
};

function job(overrides: Partial<MigrationJob>): MigrationJob {
  return {
    kind: "dependency",
    dependencyName: "@nestjs/core",
    targetVersion: "11.1.0",
    breakingChangeId: null,
    breakingChange: null,
    ...overrides,
  } as MigrationJob;
}

const apiJob = (overrides: Partial<MigrationChange> = {}) =>
  job({
    kind: "api_change",
    dependencyName: null,
    targetVersion: null,
    breakingChangeId: change.id,
    breakingChange: { ...change, ...overrides },
  });

describe("jobTitle", () => {
  it("names a dependency job by its package and version", () => {
    expect(jobTitle(job({}))).toEqual({ name: "@nestjs/core", detail: "11.1.0" });
  });

  it("names an API change job by what changed and how", () => {
    expect(jobTitle(apiJob())).toEqual({ name: "gpt-4-0613", detail: "openai model retired" });
  });

  it("falls back to the operation, then the kind", () => {
    expect(jobTitle(apiJob({ field: null })).name).toBe("chat.completions");
    expect(jobTitle(apiJob({ field: null, operation: null })).name).toBe("model retired");
  });
});

describe("jobBranch", () => {
  it("matches the branch the worker pushes for a dependency", () => {
    expect(jobBranch(job({}))).toBe("synclab/nestjs-core-11-1-0");
  });

  it("matches the branch the worker pushes for an API change", () => {
    expect(jobBranch(apiJob())).toBe("synclab/api-openai-gpt-4-0613-3f2a9c1e");
    expect(jobBranch(apiJob({ field: null, operation: null }))).toBe("synclab/api-openai-model-retired-3f2a9c1e");
  });

  it("trims a long subject to 60 characters without a trailing dash", () => {
    const branch = jobBranch(apiJob({ field: `${"a".repeat(59)}-bbbb` }));
    expect(branch).toBe(`synclab/api-openai-${"a".repeat(59)}-3f2a9c1e`);
  });
});
