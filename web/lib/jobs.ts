import type { MigrationJob } from "@/lib/types";

/**
 * A job's name and the detail beside it: the package and its target version,
 * or the model or parameter a provider changed and what kind of change it was.
 */
export function jobTitle(job: MigrationJob): { name: string; detail: string } {
  const change = job.breakingChange;
  if (job.kind === "api_change" && change) {
    return {
      name: change.field ?? change.operation ?? change.kind.replaceAll("_", " "),
      detail: `${change.provider} ${change.kind.replaceAll("_", " ")}`,
    };
  }
  return { name: job.dependencyName ?? "", detail: job.targetVersion ?? "" };
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The branch the worker pushes, as migration.processor.ts names it. */
export function jobBranch(job: MigrationJob): string {
  const change = job.breakingChange;
  if (job.kind === "api_change" && change) {
    const subject = slug(change.field ?? change.operation ?? change.kind)
      .slice(0, 60)
      .replace(/-+$/, "");
    return `synclab/api-${change.provider}-${subject}-${change.id.slice(0, 8)}`;
  }
  return `synclab/${slug(job.dependencyName ?? "")}-${slug(job.targetVersion ?? "")}`;
}
