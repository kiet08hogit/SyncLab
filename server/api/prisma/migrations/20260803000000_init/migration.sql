-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "github_repo_id" BIGINT NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "installation_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "repository_id" UUID NOT NULL,
    "dependency_name" VARCHAR(255) NOT NULL,
    "target_version" VARCHAR(50) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'QUEUED',
    "pull_request_url" VARCHAR(255),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "step" VARCHAR(100) NOT NULL,
    "output" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_github_repo_id_key" ON "repositories"("github_repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "migration_jobs_repository_id_dependency_name_target_version_key" ON "migration_jobs"("repository_id", "dependency_name", "target_version");

-- AddForeignKey
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "migration_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
