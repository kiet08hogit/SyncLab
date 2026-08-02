import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import * as Docker from 'dockerode';

@Processor('migration-queue')
export class MigrationProcessor extends WorkerHost {
  private docker: Docker;

  constructor(private readonly prisma: PrismaService) {
    super();
    // Connect to local docker socket
    this.docker = new Docker();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { jobId, repoUrl } = job.data;
    
    // Update status to IN_PROGRESS
    await this.prisma.migrationJob.update({
      where: { id: jobId },
      data: { status: 'IN_PROGRESS' },
    });

    await this.prisma.executionLog.create({
      data: { jobId, step: 'STARTED', output: `Starting migration for ${repoUrl}` }
    });

    try {
      // Pull alpine image
      await new Promise((resolve, reject) => {
        this.docker.pull('alpine:latest', (err: any, stream: any) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (err: any, res: any) => err ? reject(err) : resolve(res));
        });
      });

      // Spawn container
      const container = await this.docker.createContainer({
        Image: 'alpine:latest',
        Cmd: ['echo', 'Hello World from Sandbox'],
        Tty: false,
      });

      await container.start();

      // Get logs
      const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });

      let output = '';
      stream.on('data', (chunk) => {
        // Strip docker log headers if needed, but chunk to string works for basic text
        output += chunk.toString('utf8');
      });

      // Wait for container to finish
      await container.wait();

      // Save log
      await this.prisma.executionLog.create({
        data: { jobId, step: 'EXECUTION', output: output.trim() }
      });

      // Cleanup
      await container.remove();

      // Complete job
      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED' },
      });

    } catch (error: any) {
      // Handle failure
      await this.prisma.executionLog.create({
        data: { jobId, step: 'FAILED', output: error.message }
      });

      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: error.message },
      });
      
      throw error;
    }
  }
}
