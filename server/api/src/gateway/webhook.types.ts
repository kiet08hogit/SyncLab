export interface GithubPullRequestPayload {
  action?: string;
  pull_request?: {
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    user?: { login?: string; type?: string };
    head?: { ref?: string; repo?: { full_name?: string } | null };
  };
  repository?: {
    id?: number;
    name?: string;
    full_name?: string;
    clone_url?: string;
  };
  installation?: {
    id?: number;
  };
}

interface GithubRepositoryRef {
  id?: number;
  full_name?: string;
}

/**
 * The fields SyncLab reads from the pull_request, push, installation and
 * installation_repositories events, which share repository and installation.
 */
export interface GithubWebhookPayload extends GithubPullRequestPayload {
  repository?: GithubPullRequestPayload['repository'] & { default_branch?: string };
  /** push */
  ref?: string;
  after?: string;
  deleted?: boolean;
  /** installation */
  repositories?: GithubRepositoryRef[];
  /** installation_repositories */
  repositories_added?: GithubRepositoryRef[];
}
