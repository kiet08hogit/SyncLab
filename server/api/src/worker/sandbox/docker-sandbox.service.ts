import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import { LLM_API_KEY_ENV, type Configuration } from '../../config/configuration';
import { LogStep } from '../../common/constants';
import {
  buildClassifyPhaseEnv,
  buildContainerOptions,
  buildPhaseEnv,
  buildScanPhaseEnv,
  capClassifyText,
  type SandboxLimits,
} from './container-options';
import {
  parsePhaseResult,
  parseScannedUsages,
  type PhaseResult,
  type SandboxClassifyInput,
  type SandboxClassifyOutcome,
  type SandboxJobParams,
  type SandboxPhase,
  type SandboxRunOutcome,
  type SandboxScanOutcome,
  type SandboxScanParams,
  type StepLog,
} from './sandbox.types';

export type StepListener = (steps: StepLog[]) => Promise<void>;

/**
 * The step a phase that died without a result is logged under: the first step
 * that phase would have logged itself, so the dashboard places the failure at
 * the right stage.
 */
const FALLBACK_STEP: Record<SandboxPhase, LogStep> = {
  prepare: LogStep.CLONE,
  install: LogStep.INSTALL,
  upgrade: LogStep.UPGRADE,
  refactor: LogStep.REFACTOR,
  test: LogStep.TEST,
  validate: LogStep.VALIDATE,
  publish: LogStep.PR,
  clone: LogStep.CLONE,
  scan: LogStep.SCAN,
  // Classify reads release notes and changelogs; its output is returned to the
  // monitor rather than written to a job's log.
  classify: LogStep.CHANGELOG,
};

@Injectable()
export class DockerSandboxService {
  private readonly logger = new Logger(DockerSandboxService.name);
  private readonly docker: Docker;
  private readonly image: string;
  private readonly limits: SandboxLimits;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService<Configuration, true>) {
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
   * accepts the change. A passing suite still has to pass validate before
   * publish. A test failure or a failed check is left on the shared volume
   * for the next refactor attempt to read.
   */
  async run(
    jobId: string,
    params: SandboxJobParams,
    onSteps: StepListener,
  ): Promise<SandboxRunOutcome> {
    const volumeName = `synclab-job-${jobId}`;
    await this.docker.createVolume({ Name: volumeName, Labels: { 'com.synclab.job': jobId } });

    try {
      const prepared = await this.runPhase(
        'prepare',
        volumeName,
        buildPhaseEnv('prepare', params, 1),
      );
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

      // Repository code can write to the volume from install on, so what
      // validate compares the migrated tree against is recorded now. Later
      // validate runs trust that file only while it matches this digest.
      const validateBaseline = await this.runPhase('validate', volumeName, {
        ...buildPhaseEnv('validate', params, 1),
        VALIDATE_BASELINE: 'true',
      });
      await onSteps(validateBaseline.steps);
      if (!validateBaseline.ok) {
        return {
          ok: false,
          error: validateBaseline.error ?? 'sandbox phase "validate" could not record its baseline',
        };
      }
      const validateBaselineDigest = validateBaseline.data?.baselineDigest;
      if (typeof validateBaselineDigest !== 'string') {
        return { ok: false, error: 'sandbox phase "validate" did not report its baseline digest' };
      }

      const installed = await this.runPhase(
        'install',
        volumeName,
        buildPhaseEnv('install', params, 1),
      );
      await onSteps(installed.steps);
      if (!installed.ok) {
        return { ok: false, error: installed.error ?? 'sandbox phase "install" failed' };
      }

      // Without this, a suite that was already failing reads as a migration
      // the model got wrong, and every refactor attempt is spent on it.
      const baseline = await this.runPhase('test', volumeName, {
        ...buildPhaseEnv('test', params, 1),
        TEST_BASELINE: 'true',
      });
      await onSteps(baseline.steps);
      if (!baseline.ok) {
        return {
          ok: false,
          error: `the test suite already fails before the ${params.migration.kind === 'api_change' ? 'migration' : 'upgrade'}, so a migration cannot be verified: ${baseline.error ?? 'test suite failed'}`,
        };
      }

      if (params.migration.kind === 'dependency') {
        const upgraded = await this.runPhase(
          'upgrade',
          volumeName,
          buildPhaseEnv('upgrade', params, 1),
        );
        await onSteps(upgraded.steps);
        if (!upgraded.ok) {
          return { ok: false, error: upgraded.error ?? 'sandbox phase "upgrade" failed' };
        }
      }

      const maxAttempts = params.llm.maxAttempts;
      let accepted = false;
      let lastGate: 'tests' | 'validation' = 'tests';
      let lastError: string | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const refactored = await this.runPhase(
          'refactor',
          volumeName,
          buildPhaseEnv('refactor', params, attempt),
        );
        await onSteps(refactored.steps);
        if (!refactored.ok) {
          return {
            ok: false,
            error: refactored.error ?? 'sandbox phase "refactor" failed',
            retryable: refactored.data?.retryable === true,
          };
        }

        const tested = await this.runPhase(
          'test',
          volumeName,
          buildPhaseEnv('test', params, attempt),
        );
        await onSteps(tested.steps);

        if (!tested.ok) {
          lastGate = 'tests';
          lastError = tested.error ?? 'test suite failed';
          continue;
        }

        // The suite passing is not enough: validate checks the migrated tree
        // and, on failure, leaves its reason where the next refactor reads it.
        const validated = await this.runPhase('validate', volumeName, {
          ...buildPhaseEnv('validate', params, attempt),
          VALIDATE_BASELINE_DIGEST: validateBaselineDigest,
        });
        await onSteps(validated.steps);
        if (validated.ok) {
          accepted = true;
          break;
        }

        lastGate = 'validation';
        lastError = validated.error ?? 'validation failed';
      }

      if (!accepted) {
        return {
          ok: false,
          error: `${lastGate} still failing after ${maxAttempts} refactor attempt(s): ${lastError}`,
        };
      }

      const published = await this.runPhase('publish', volumeName, {
        ...buildPhaseEnv('publish', params, maxAttempts),
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

  /**
   * Clones the default branch, then scans it in a second container with no
   * network and no token. The usages travel back in the scan phase's result.
   */
  async scan(scanId: string, params: SandboxScanParams): Promise<SandboxScanOutcome> {
    const volumeName = `synclab-scan-${scanId}`;
    await this.docker.createVolume({ Name: volumeName, Labels: { 'com.synclab.scan': scanId } });
    const steps: StepLog[] = [];
    const output = () => steps.map((step) => `[${step.step}]\n${step.output}`).join('\n\n');

    try {
      const cloned = await this.runPhase('clone', volumeName, buildScanPhaseEnv('clone', params));
      steps.push(...cloned.steps);
      const commitSha = cloned.data?.headSha;
      if (!cloned.ok || typeof commitSha !== 'string') {
        return {
          ok: false,
          error: cloned.error ?? 'sandbox phase "clone" did not report the cloned commit',
          usages: [],
          output: output(),
        };
      }

      const scanned = await this.runPhase('scan', volumeName, buildScanPhaseEnv('scan', params));
      steps.push(...scanned.steps);
      if (!scanned.ok) {
        return {
          ok: false,
          error: scanned.error ?? 'sandbox phase "scan" failed',
          commitSha,
          usages: [],
          output: output(),
        };
      }

      return {
        ok: true,
        commitSha,
        usages: parseScannedUsages(scanned.data?.usages),
        output: output(),
      };
    } finally {
      await this.docker
        .getVolume(volumeName)
        .remove({ force: true })
        .catch((error: unknown) =>
          this.logger.warn(`Failed to remove volume ${volumeName}: ${String(error)}`),
        );
    }
  }

  /**
   * Asks the model which breaking changes a source's new lines announce. The
   * phase needs no volume content, but every container mounts one, so a
   * short-lived empty volume is created and always removed. The model is the
   * one configured for migrations. The changes come back unverified: the
   * caller checks each one's evidence against the snapshot.
   */
  async classify(input: SandboxClassifyInput): Promise<SandboxClassifyOutcome> {
    const llm = this.config.get('llm', { infer: true });
    const keyEnv = LLM_API_KEY_ENV[llm.provider];
    if (!llm.apiKey) {
      return {
        ok: false,
        error: `LLM_PROVIDER is ${llm.provider} but ${keyEnv} is not set, so the classify phase cannot run.`,
        changes: [],
        output: '',
      };
    }

    const runId = randomUUID();
    const volumeName = `synclab-classify-${runId}`;
    if (capClassifyText(input.text).truncated) {
      this.logger.warn(`Classifying only the first part of the new text from ${input.url}`);
    }
    await this.docker.createVolume({ Name: volumeName, Labels: { 'com.synclab.classify': runId } });

    try {
      const result = await this.runPhase('classify', volumeName, buildClassifyPhaseEnv(input, llm));
      const output = result.steps.map((step) => `[${step.step}]\n${step.output}`).join('\n\n');
      const changes = result.data?.changes;

      if (!result.ok) {
        return {
          ok: false,
          error: result.error ?? 'sandbox phase "classify" failed',
          retryable: result.data?.retryable === true,
          changes: [],
          output,
        };
      }

      return { ok: true, changes: Array.isArray(changes) ? changes : [], output };
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
    env: Record<string, string>,
  ): Promise<PhaseResult> {
    const container = await this.docker.createContainer(
      buildContainerOptions({
        phase,
        image: this.image,
        volumeName,
        env,
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
      // It is logged under the step the dashboard tracks for this phase.
      const step = env.TEST_BASELINE === 'true' ? LogStep.BASELINE : FALLBACK_STEP[phase];
      return {
        phase,
        ok: false,
        error: `sandbox phase "${phase}" exited with code ${exitCode} without reporting a result`,
        steps: [{ step, output: logs.trim(), exitCode }],
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
