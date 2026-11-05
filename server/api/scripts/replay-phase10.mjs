import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { ApiMonitorService } from '../dist/monitor/api-monitor.service.js';
import { ImpactService } from '../dist/impact/impact.service.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';

// This is a controlled provider announcement for the Phase 10 completion run.
// It belongs only in a disposable local database, never in production data.
if (process.env.PHASE10_REPLAY !== '1' || !/^127\.0\.0\.1:55432$/.test(new URL(process.env.DATABASE_URL).host)) {
  throw new Error('Run only with PHASE10_REPLAY=1 and the isolated Phase 10 database on 127.0.0.1:55432');
}

const fixture = (name) => readFile(fileURLToPath(new URL(`../src/monitor/fixtures/${name}`, import.meta.url)), 'utf8');
const sourceUrl = 'https://github.com/kiet08hogit/SyncLab/blob/codex/phase10-dashboard-dogfood/server/api/src/monitor/fixtures/phase10-fallbacks-after.md';
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const prisma = app.get(PrismaService);
  const classified = JSON.parse(await fixture('phase10-fallbacks-classified.json'));
  // Replay the fixture classifier output so the completion test has no live
  // model dependency. The monitor still verifies the quote against the snapshot.
  const monitor = new ApiMonitorService(prisma, app.get(ImpactService), {
    classify: async () => ({ ok: true, changes: classified.changes }),
  });
  const provider = await prisma.apiProvider.findUniqueOrThrow({ where: { slug: 'anthropic' } });
  const source = await prisma.apiSource.upsert({
    where: { providerId_kind_url: { providerId: provider.id, kind: 'release_notes', url: sourceUrl } },
    create: { providerId: provider.id, kind: 'release_notes', url: sourceUrl },
    update: {},
    include: { provider: { select: { slug: true } } },
  });
  const baseline = await monitor.recordSnapshot(source, await fixture('phase10-fallbacks-before.md'));
  const replay = await monitor.recordSnapshot(source, await fixture('phase10-fallbacks-after.md'));
  const change = await prisma.breakingChange.findFirst({
    where: { providerId: provider.id, field: 'fallbacks', kind: 'param_removed' },
    select: { id: true, status: true, operation: true, field: true },
  });
  console.log(JSON.stringify({ baseline, replay, change }));
  if (!change) process.exitCode = 1;
} finally {
  await app.close();
}
