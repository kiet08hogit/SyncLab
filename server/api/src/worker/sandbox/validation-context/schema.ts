import type { PrismaService } from '../../../prisma/prisma.service';
import { requestSchemas } from '../../../monitor/openapi-spec';
import type { SandboxMigration } from '../sandbox.types';

/**
 * The request schemas the OpenAI schema check holds literal request objects
 * against: every operation of the newest OpenAI spec snapshot, and the files
 * the migration rewrites. Only an OpenAI API change gets them. An empty object
 * means the check has nothing to reject, which is also the case before the
 * monitor has read the spec once.
 */
export async function schemaContext(
  prisma: PrismaService,
  migration: SandboxMigration,
): Promise<Record<string, unknown>> {
  if (migration.kind !== 'api_change' || migration.change.provider !== 'openai') {
    return {};
  }

  const snapshot = await prisma.apiSourceSnapshot.findFirst({
    where: { source: { kind: 'spec', provider: { slug: 'openai' } } },
    orderBy: { fetchedAt: 'desc' },
    select: { content: true },
  });
  if (!snapshot) {
    return {};
  }

  return {
    openaiSchema: { files: migration.files, operations: requestSchemas(snapshot.content) },
  };
}
