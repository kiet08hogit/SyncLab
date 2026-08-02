import { Controller, Post, Body, Req } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@Controller('webhook')
export class WebhookController {
  constructor(
    @InjectQueue('migration-queue') private readonly migrationQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async handleWebhook(@Body() payload: any, @Req() req: any) {
    // Basic signature validation placeholder
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
      // In MVP, we might allow it or fail
      // return { error: 'No signature' };
    }

    // Mock parsing the release payload
    const repoId = payload.repository?.id || 12345;
    const repoName = payload.repository?.full_name || 'example/repo';
    const depName = payload.release?.name || 'react';
    const targetVer = payload.release?.tag_name || 'v18.0.0';

    // Ensure repository exists
    let repo = await this.prisma.repository.findUnique({
      where: { githubRepoId: repoId }
    });

    if (!repo) {
      repo = await this.prisma.repository.create({
        data: {
          githubRepoId: repoId,
          fullName: repoName,
          installationId: 0, // Mock for MVP
        }
      });
    }

    // Create MigrationJob
    const job = await this.prisma.migrationJob.create({
      data: {
        repositoryId: repo.id,
        dependencyName: depName,
        targetVersion: targetVer,
        status: 'QUEUED',
      }
    });

    // Enqueue the job
    await this.migrationQueue.add('process-migration', {
      jobId: job.id,
      repoUrl: payload.repository?.clone_url || 'https://github.com/example/repo.git',
    });

    return { success: true, message: 'Job queued', id: job.id };
  }
}
