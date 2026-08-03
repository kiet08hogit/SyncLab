import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import type { Configuration } from '../../config/configuration';
import {
  buildContainerOptions,
  buildPhaseEnv,
  type SandboxLimits,
} from './container-options';
import {
  SANDBOX_PHASES,
  parsePhaseResult,
  type PhaseResult,
  type SandboxJobParams,
  type SandboxPhase,
  type SandboxRunOutcome,
  type StepLog,
} from './sandbox.types';

export type StepListener = (steps: StepLog[]) => Promise<void>;

@Injectable()
export class DockerSandboxService {
  private readonly logger = new Logger(DockerSandboxService.name);
  private readonly docker: Docker;
  private readonly image: string;
  private readonly limits: SandboxLimits;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Configuration, true>) {
    const sandbox = config.get('sandbox', { infer: true });

    this.docker = sandbox.dockerSocketPath
      ? new Docker({ socketPath: sandbox.dockerSocketPath })
      : new Docker();

    this.image = sandbox.image;
    this.timeoutMs = sandbox.timeoutMs;
    this.limits = {
      memoryBytes: sandbox.memoryBytes,
      nanoCpus: sandbox.nanoCpus,
      pidsLimit: sandbox.pidsLimit,
    };
  }

  /**
   * The sandbox image is built locally rather than pulled, so a missing image
   * is a setup mistake worth reporting clearly instead of a registry lookup.
   */
  async ensureImage(): Promise<void> {
    try {
      await this.docker.getImage(this.image).inspect();
    } catch {
      throw new Error(
        `Sandbox image "${this.image}" is not available. Build it with \`npm run sandbox:build\`.`,
      );
    }
  }

  async run(
    jobId: string,
    params: SandboxJobParams,
    onSteps: StepListener,
  ): Promise<SandboxRunOutcome> {
    const volumeName = `synclab-job-${jobId}`;
    await this.docker.createVolume({ Name: volumeName, Labels: { 'com.synclab.job': jobId } });

    let pullRequestUrl: string | undefined;

    try {
      for (const phase of SANDBOX_PHASES) {
        const result = await this.runPhase(phase, volumeName, params);
        await onSteps(result.steps);

        const url = result.data?.pullRequestUrl;
        if (typeof url === 'string') {
          pullRequestUrl = url;
        }

        if (!result.ok) {
          return { ok: false, error: result.error ?? `sandbox phase "${phase}" failed` };
        }
      }

      return { ok: true, pullRequestUrl };
    } finally {
      await this.docker
        .getVolume(volumeName)
        .remove({ force: true })
        .catch((error: unknown) =>
          this.logger.warn(`Failed to remove volume ${volumeName}: ${String(error)}`),
        );
    }
  }

  private async runPhase(
    phase: SandboxPhase,
    volumeName: string,
    params: SandboxJobParams,
  ): Promise<PhaseResult> {
    const container = await this.docker.createContainer(
      buildContainerOptions({
        phase,
        image: this.image,
        volumeName,
        env: buildPhaseEnv(phase, params),
        limits: this.limits,
      }),
    );

    try {
      // Attaching before start avoids the race where output is produced before
      // the log stream is connected.
      const stream = await container.attach({ stream: true, stdout: true, stderr: true });

      const stdout = new PassThrough();
      const stderr = new PassThrough();
      this.docker.modem.demuxStream(stream, stdout, stderr);

      let logs = '';
      const collect = (chunk: Buffer) => {
        logs += chunk.toString('utf8');
      };
      stdout.on('data', collect);
      stderr.on('data', collect);

      const streamClosed = new Promise<void>((resolve) => {
        stream.on('end', resolve);
        stream.on('close', resolve);
      });

      await container.start();
      const exitCode = await this.waitWithTimeout(container, phase);
      await streamClosed;

      const parsed = parsePhaseResult(logs);
      if (parsed) {
        return parsed;
      }

      // The sandbox always emits a result line, so its absence means the
      // process died before it could - the raw log is the only diagnostic left.
      return {
        phase,
        ok: false,
        error: `sandbox phase "${phase}" exited with code ${exitCode} without reporting a result`,
        steps: [{ step: phase.toUpperCase(), output: logs.trim(), exitCode }],
      };
    } finally {
      await container
        .remove({ force: true })
        .catch((error: unknown) =>
          this.logger.warn(`Failed to remove ${phase} container: ${String(error)}`),
        );
    }
  }

  private async waitWithTimeout(container: Docker.Container, phase: SandboxPhase): Promise<number> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        void container
          .kill()
          .catch(() => undefined)
          .then(() =>
            reject(
              new Error(`Sandbox phase "${phase}" exceeded ${this.timeoutMs}ms and was killed`),
            ),
          );
      }, this.timeoutMs);
    });

    try {
      const result = (await Promise.race([container.wait(), timeout])) as { StatusCode: number };
      return result.StatusCode;
    } finally {
      clearTimeout(timer);
    }
  }
}
