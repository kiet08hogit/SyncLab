import "server-only";

// Calls GitHub as the signed-in user, with the user access token the SyncLab
// GitHub App issued at sign-in. GitHub only returns installations and
// repositories that both the user and the App can reach.

// GitHub Enterprise, or a local stub in tests. Mirrors GITHUB_API_URL in server/api.
const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const PAGE_SIZE = 100;

export interface GithubAppConfig {
  clientId: string;
  clientSecret: string;
}

export function githubAppConfig(): GithubAppConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Where a user installs the App on more accounts or repositories. */
export function installUrl(): string | null {
  const slug = process.env.GITHUB_APP_SLUG;
  return slug ? `https://github.com/apps/${encodeURIComponent(slug)}/installations/new` : null;
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The user token was revoked or expired early. The caller should ask the user to sign in again. */
export class GithubUnauthorizedError extends GithubError {}

async function githubGet<T>(token: string, path: string, accept = "application/vnd.github+json"): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: accept, Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
  });
  if (response.status === 401) throw new GithubUnauthorizedError("GitHub rejected the session token", 401);
  if (!response.ok) throw new GithubError(`GitHub GET ${path} failed with status ${response.status}`, response.status);
  return (await response.json()) as T;
}

export async function exchangeCode(
  config: GithubAppConfig,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; expiresIn: number | null }> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  // GitHub answers 200 even for a bad code and reports it in the body.
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description ?? `Token exchange failed with status ${response.status}`);
  }
  return { accessToken: body.access_token, expiresIn: body.expires_in ?? null };
}

export interface GithubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

export function getUser(token: string) {
  return githubGet<GithubUser>(token, "/user");
}

export interface Installation {
  id: number;
  account: { login: string; avatar_url: string; type: string; html_url: string };
  repository_selection: "all" | "selected";
  html_url: string;
  created_at: string;
  suspended_at: string | null;
}

export async function getUserInstallations(token: string): Promise<Installation[]> {
  const installations: Installation[] = [];
  for (let page = 1; ; page++) {
    const body = await githubGet<{ installations: Installation[] }>(
      token,
      `/user/installations?per_page=${PAGE_SIZE}&page=${page}`,
    );
    installations.push(...body.installations);
    if (body.installations.length < PAGE_SIZE) return installations;
  }
}

export interface InstalledRepository {
  id: number;
  fullName: string;
  private: boolean;
  installationId: number;
}

/** Every repository the user can reach through any installation, sorted by name. */
export async function getAccessibleRepositories(token: string): Promise<InstalledRepository[]> {
  const installations = (await getUserInstallations(token)).filter((installation) => !installation.suspended_at);
  const lists = await Promise.all(
    installations.map(async (installation) => {
      const repositories: InstalledRepository[] = [];
      for (let page = 1; ; page++) {
        const body = await githubGet<{ repositories: Array<{ id: number; full_name: string; private: boolean }> }>(
          token,
          `/user/installations/${installation.id}/repositories?per_page=${PAGE_SIZE}&page=${page}`,
        );
        repositories.push(
          ...body.repositories.map((repository) => ({
            id: repository.id,
            fullName: repository.full_name,
            private: repository.private,
            installationId: installation.id,
          })),
        );
        if (body.repositories.length < PAGE_SIZE) return repositories;
      }
    }),
  );
  return lists.flat().sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export interface Dependency {
  name: string;
  /** The range written in package.json, such as "^14.2.0". */
  range: string;
  dev: boolean;
}

/** Dependencies declared in the repository's root package.json, or null when it has none. */
export async function getDependencies(token: string, fullName: string): Promise<Dependency[] | null> {
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    manifest = await githubGet(token, `/repos/${fullName}/contents/package.json`, "application/vnd.github.raw+json");
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return null;
    throw error;
  }
  const entries = (record: Record<string, string> | undefined, dev: boolean) =>
    Object.entries(record ?? {}).map(([name, range]) => ({ name, range, dev }));
  return [...entries(manifest.dependencies, false), ...entries(manifest.devDependencies, true)].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
