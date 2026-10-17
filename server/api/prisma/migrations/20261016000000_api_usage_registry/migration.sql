-- CreateTable
CREATE TABLE "api_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "repository_id" UUID NOT NULL,
    "trigger" VARCHAR(50) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'QUEUED',
    "queued_for" UUID,
    "commit_sha" VARCHAR(40),
    "error_message" TEXT,
    "output" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scan_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "file" VARCHAR(1024) NOT NULL,
    "line" INTEGER NOT NULL,
    "style" VARCHAR(10) NOT NULL,
    "method" VARCHAR(255),
    "operation" VARCHAR(255),
    "params" TEXT[],
    "model_ids" TEXT[],
    "dynamic" BOOLEAN NOT NULL,

    CONSTRAINT "api_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_providers_slug_key" ON "api_providers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "repository_scans_queued_for_key" ON "repository_scans"("queued_for");

-- CreateIndex
CREATE INDEX "repository_scans_repository_id_created_at_idx" ON "repository_scans"("repository_id", "created_at");

-- CreateIndex
CREATE INDEX "api_usages_scan_id_idx" ON "api_usages"("scan_id");

-- CreateIndex
CREATE INDEX "api_usages_provider_id_operation_idx" ON "api_usages"("provider_id", "operation");

-- AddForeignKey
ALTER TABLE "repository_scans" ADD CONSTRAINT "repository_scans_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usages" ADD CONSTRAINT "api_usages_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "repository_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usages" ADD CONSTRAINT "api_usages_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "api_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SeedProviders
INSERT INTO "api_providers" ("slug") VALUES ('anthropic'), ('openai');
