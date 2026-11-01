-- An API-change job may name the SDK the change requires.
-- Prisma cannot express this check, so it lives only here.
-- Keep dependency jobs unique by package and version, while allowing multiple
-- API changes announced in one SDK release to queue separate jobs.
DROP INDEX "migration_jobs_repository_id_dependency_name_target_version_key";
CREATE UNIQUE INDEX "migration_jobs_repository_id_dependency_name_target_version_key"
ON "migration_jobs"("repository_id", "dependency_name", "target_version")
WHERE "kind" = 'dependency';
ALTER TABLE "migration_jobs" DROP CONSTRAINT "migration_jobs_kind_fields_check";

ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_kind_fields_check" CHECK (
    ("kind" = 'dependency' AND "dependency_name" IS NOT NULL AND "target_version" IS NOT NULL AND "breaking_change_id" IS NULL)
    OR (
        "kind" = 'api_change'
        AND "breaking_change_id" IS NOT NULL
        AND (
            ("dependency_name" IS NULL AND "target_version" IS NULL)
            OR ("dependency_name" IS NOT NULL AND "target_version" IS NOT NULL)
        )
    )
);
