-- CreateTable
CREATE TABLE "api_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "kind" VARCHAR(50) NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "last_checked_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_source_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "content" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_source_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breaking_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "kind" VARCHAR(50) NOT NULL,
    "operation" VARCHAR(255),
    "field" VARCHAR(255),
    "replacement" VARCHAR(1024),
    "effective_at" DATE,
    "section" VARCHAR(1024),
    "evidence" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "subject_key" VARCHAR(512) NOT NULL,
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "breaking_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_sources_provider_id_kind_url_key" ON "api_sources"("provider_id", "kind", "url");

-- CreateIndex
CREATE INDEX "api_source_snapshots_source_id_fetched_at_idx" ON "api_source_snapshots"("source_id", "fetched_at");

-- CreateIndex
CREATE INDEX "breaking_changes_status_detected_at_idx" ON "breaking_changes"("status", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "breaking_changes_provider_id_kind_subject_key_key" ON "breaking_changes"("provider_id", "kind", "subject_key");

-- AddForeignKey
ALTER TABLE "api_sources" ADD CONSTRAINT "api_sources_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "api_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_source_snapshots" ADD CONSTRAINT "api_source_snapshots_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "api_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breaking_changes" ADD CONSTRAINT "breaking_changes_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "api_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breaking_changes" ADD CONSTRAINT "breaking_changes_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "api_source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The model deprecation pages the monitor polls. Spec, release note and SDK
-- changelog sources arrive with their parsers.
INSERT INTO "api_sources" ("provider_id", "kind", "url")
SELECT "id", 'deprecations', 'https://platform.claude.com/docs/en/about-claude/model-deprecations'
FROM "api_providers" WHERE "slug" = 'anthropic';

INSERT INTO "api_sources" ("provider_id", "kind", "url")
SELECT "id", 'deprecations', 'https://developers.openai.com/api/docs/deprecations'
FROM "api_providers" WHERE "slug" = 'openai';
