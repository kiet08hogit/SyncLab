-- A migration job is either a dependency upgrade or a fix for a confirmed API change.
ALTER TABLE "migration_jobs" ADD COLUMN "kind" VARCHAR(20) NOT NULL DEFAULT 'dependency',
ADD COLUMN "breaking_change_id" UUID,
ALTER COLUMN "dependency_name" DROP NOT NULL,
ALTER COLUMN "target_version" DROP NOT NULL;

CREATE UNIQUE INDEX "migration_jobs_repository_id_breaking_change_id_key" ON "migration_jobs"("repository_id", "breaking_change_id");

ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_breaking_change_id_fkey" FOREIGN KEY ("breaking_change_id") REFERENCES "breaking_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot express this, so it lives only here.
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_kind_fields_check" CHECK (
    ("kind" = 'dependency' AND "dependency_name" IS NOT NULL AND "target_version" IS NOT NULL AND "breaking_change_id" IS NULL)
    OR ("kind" = 'api_change' AND "dependency_name" IS NULL AND "target_version" IS NULL AND "breaking_change_id" IS NOT NULL)
);
