import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import type { Configuration } from '../../config/configuration';
import { buildContainerOptions, buildPhaseEnv, type SandboxLimits } from './container-options';
import {
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

  /**
   * Prepare and install, prove the suite passes on the current version, then
   * upgrade and alternate refactor and test until the repository's own suite
   * accepts the change, then publish. Each test failure is left on the shared
   * volume for the next refactor attempt to read.
   */
  async run(
    jobId: string,
    params: SandboxJobParams,
    onSteps: StepListener,
  ): Promise<SandboxRunOutcome> {
    const volumeName = `synclab-job-${jobId}`;
    await this.docker.createVolume({ Name: volumeName, Labels: { 'com.synclab.job': jobId } });

    try {
      const prepared = await this.runPhase('prepare', volumeName, params, 1);
      await onSteps(prepared.steps);
      if (!prepared.ok) {
        return { ok: false, error: prepared.error ?? 'sandbox phase "prepare" failed' };
      }

      // Publish clones afresh at exactly this commit rather than trusting the
      // checkout on the volume, which repository code has been able to modify.
      const baseSha = prepared.data?.headSha;
      if (typeof baseSha !== 'string') {
        return { ok: false, error: 'sandbox phase "prepare" did not report the cloned commit' };
      }

      const installed = await this.runPhase('install', volumeName, params, 1);
      await onSteps(installed.steps);
      if (!installed.ok) {
        return { ok: false, error: installed.error ?? 'sandbox phase "install" failed' };
      }

      // Without this, a suite that was already failing reads as a migration
      // the model got wrong, and every refactor attempt is spent on it.
      const baseline = await this.runPhase('test', volumeName, params, 1, {
        TEST_BASELINE: 'true',
      });
      await onSteps(baseline.steps);
      if (!baseline.ok) {
        return {
          ok: false,
          error: `the test suite already fails before the upgrade, so a migration cannot be verified: ${baseline.error ?? 'test suite failed'}`,
        };
      }

      const upgraded = await this.runPhase('upgrade', volumeName, params, 1);
      await onSteps(upgraded.steps);
      if (!upgraded.ok) {
        return { ok: false, error: upgraded.error ?? 'sandbox phase "upgrade" failed' };
      }

      const maxAttempts = params.llm.maxAttempts;
      let testsPassed = false;
      let lastTestError: string | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const refactored = await this.runPhase('refactor', volumeName, params, attempt);
        await onSteps(refactored.steps);
        if (!refactored.ok) {
          return {
            ok: false,
            error: refactored.error ?? 'sandbox phase "refactor" failed',
            retryable: refactored.data?.retryable === true,
          };
        }

        const tested = await this.runPhase('test', volumeName, params, attempt);
        await onSteps(tested.steps);

        if (tested.ok) {
          testsPassed = true;
          break;
        }

        lastTestError = tested.error ?? 'test suite failed';
      }

      if (!testsPassed) {
        return {
          ok: false,
          error: `tests still failing after ${maxAttempts} refactor attempt(s): ${lastTestError}`,
        };
      }

      const published = await this.runPhase('publish', volumeName, params, maxAttempts, {
        BASE_SHA: baseSha,
      });
      await onSteps(published.steps);
      if (!published.ok) {
        return { ok: false, error: published.error ?? 'sandbox phase "publish" failed' };
      }

      // Not retryable: rerunning the same refactor would change nothing again.
      if (published.data?.skipped === true) {
        return { ok: false, error: 'refactor produced no changes' };
      }

      const url = published.data?.pullRequestUrl;

      return { ok: true, pullRequestUrl: typeof url === 'string' ? url : undefined };
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
    attempt: number,
    extraEnv: Record<string, string> = {},
  ): Promise<PhaseResult> {
    const container = await this.docker.createContainer(
      buildContainerOptions({
        phase,
        image: this.image,
        volumeName,
        env: { ...buildPhaseEnv(phase, params, attempt), ...extraEnv },
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
