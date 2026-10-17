-- The sources Phase 6b reads beyond the deprecation pages: OpenAI's OpenAPI
-- spec, diffed deterministically, and both providers' API release notes and
-- TypeScript SDK changelogs, classified by the configured model.
INSERT INTO "api_sources" ("provider_id", "kind", "url")
SELECT "id", 'spec', 'https://raw.githubusercontent.com/openai/openai-openapi/main/openapi.json'
FROM "api_providers" WHERE "slug" = 'openai';

INSERT INTO "api_sources" ("provider_id", "kind", "url")
SELECT "id", 'release_notes', 'https://platform.claude.com/docs/en/release-notes/overview'
FROM "api_providers" WHERE "slug" = 'anthropic';

INSERT INTO "api_sources" ("provider_id", "kind", "url")
SELECT "id", 'release_notes', 'https://developers.openai.com/api/docs/changelog'
FROM "api_providers" WHERE "slug" = 'openai';

INSERT INTO "api_sources" ("provider_id", "kind", "url")
SELECT "id", 'sdk_changelog', 'https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/CHANGELOG.md'
FROM "api_providers" WHERE "slug" = 'anthropic';

INSERT INTO "api_sources" ("provider_id", "kind", "url")
SELECT "id", 'sdk_changelog', 'https://raw.githubusercontent.com/openai/openai-node/main/CHANGELOG.md'
FROM "api_providers" WHERE "slug" = 'openai';
