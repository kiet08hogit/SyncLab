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
