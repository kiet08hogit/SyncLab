import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Configuration, GithubConfig } from '../config/configuration';

type CreateAppAuth = typeof import('@octokit/auth-app').createAppAuth;

@Injectable()
export class GithubTokenService {
  private readonly logger = new Logger(GithubTokenService.name);
  private createAppAuthPromise?: Promise<CreateAppAuth>;

  constructor(private readonly config: ConfigService<Configuration, true>) {}

  /**
   * @octokit/auth-app is ESM-only and this package compiles to CommonJS, so it
   * has to be pulled in with a dynamic import.
   */
  private loadCreateAppAuth(): Promise<CreateAppAuth> {
    this.createAppAuthPromise ??= import('@octokit/auth-app').then(
      (module) => module.createAppAuth,
    );
    return this.createAppAuthPromise;
  }

  /**
   * Prefers a GitHub App installation token, which is scoped to one repository
   * and expires in an hour. Falls back to a Personal Access Token so the
   * sandbox can be exercised locally before an App exists.
   */
  async getInstallationToken(installationId: bigint): Promise<string> {
    const github: GithubConfig = this.config.get('github', { infer: true });

    if (github.appId && github.privateKey && installationId > 0n) {
      const createAppAuth = await this.loadCreateAppAuth();
      const auth = createAppAuth({
        appId: github.appId,
        privateKey: github.privateKey,
      });

      const result = await auth({
        type: 'installation',
        installationId: Number(installationId),
      });

      return result.token;
    }

    if (github.token) {
      this.logger.warn(
        'Falling back to GITHUB_TOKEN. Configure GITHUB_APP_ID and GITHUB_PRIVATE_KEY before running against repositories you do not own.',
      );
      return github.token;
    }

    throw new Error(
      'No GitHub credentials available. Set GITHUB_APP_ID and GITHUB_PRIVATE_KEY, or GITHUB_TOKEN for local development.',
    );
  }
}
