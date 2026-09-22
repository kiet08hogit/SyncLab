import { Prisma } from '@prisma/client';
import { JobStatus } from '../common/constants';
import type { PrismaService } from '../prisma/prisma.service';

export type JobWithRepository = Prisma.MigrationJobGetPayload<{
  include: { repository: true };
}>;

export type ClaimResult =
  | { kind: 'claimed'; record: JobWithRepository }
  | { kind: 'skipped'; pullRequestUrl: string | null };

/**
 * Takes a row lock so two workers cannot start the same migration. A job that
 * already produced a pull request is left alone; anything else is marked
 * IN_PROGRESS for this attempt.
 */
export async function claimMigrationJob(
  prisma: PrismaService,
  jobId: string,
): Promise<ClaimResult> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ status: string; pull_request_url: string | null }>>`
      SELECT status, pull_request_url
      FROM migration_jobs
      WHERE id = ${jobId}::uuid
      FOR UPDATE
    `;

    const row = locked[0];
    if (!row) {
      throw new Error(`MigrationJob ${jobId} no longer exists`);
    }

    if (row.status === JobStatus.COMPLETED) {
      return { kind: 'skipped', pullRequestUrl: row.pull_request_url };
    }

    await tx.migrationJob.update({
      where: { id: jobId },
      data: { status: JobStatus.IN_PROGRESS, errorMessage: null },
    });

    const record = await tx.migrationJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { repository: true },
    });

    return { kind: 'claimed', record };
  });
}
