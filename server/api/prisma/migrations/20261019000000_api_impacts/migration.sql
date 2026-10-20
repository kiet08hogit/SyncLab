-- Repositories and files a confirmed breaking change affects.
CREATE TABLE "api_impacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "breaking_change_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "confidence" VARCHAR(20) NOT NULL,
    "files" TEXT[],

    CONSTRAINT "api_impacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "api_impacts_repository_id_idx" ON "api_impacts"("repository_id");

CREATE UNIQUE INDEX "api_impacts_breaking_change_id_repository_id_key" ON "api_impacts"("breaking_change_id", "repository_id");

ALTER TABLE "api_impacts" ADD CONSTRAINT "api_impacts_breaking_change_id_fkey" FOREIGN KEY ("breaking_change_id") REFERENCES "breaking_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "api_impacts" ADD CONSTRAINT "api_impacts_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
