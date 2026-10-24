-- An API-change job may name the SDK the change requires.
-- Prisma cannot express this check, so it lives only here.
-- The unique key on (repository, package, version) still applies, so one job
-- per repository and SDK version, whether it is a dependency upgrade or an API change.
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
