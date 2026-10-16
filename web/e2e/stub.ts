import http from "node:http";

// One local server stands in for everything outside SyncLab: GitHub's web host
// (sign-in), GitHub's REST API (for the dashboard and the API), and the npm
// registry. The web app and the API reach it through GITHUB_URL,
// GITHUB_API_URL, and NPM_REGISTRY_URL.

export const CLIENT_ID = "e2e-client-id";
export const CLIENT_SECRET = "e2e-client-secret";
export const USER_TOKEN = "e2e-user-token";
export const LOGIN = "octo-e2e";
const CODE = "e2e-oauth-code";

export const INSTALLATION_ID = 501;
export const REPOSITORIES = [
  { id: 9001, full_name: "acme/web", private: false },
  { id: 9002, full_name: "acme/api", private: true },
];

const PACKAGE_JSON: Record<string, unknown> = {
  "acme/web": { dependencies: { next: "^15.0.0", zod: "^3.23.8" }, devDependencies: { vitest: "^2.0.0" } },
  "acme/api": { dependencies: { express: "^4.21.0" } },
};

const PACKAGES: Record<string, { latest: string; versions: string[] }> = {
  zod: { latest: "4.1.0", versions: ["3.23.8", "4.0.0", "4.1.0", "4.2.0-beta.1"] },
  next: { latest: "15.1.0", versions: ["15.0.0", "15.1.0"] },
  vitest: { latest: "3.0.0", versions: ["2.0.0", "3.0.0"] },
  express: { latest: "5.1.0", versions: ["4.21.0", "5.1.0"] },
};

// next/image only accepts GitHub's avatar host. The tests answer the image
// optimizer in the browser, so these are never fetched.
function avatar(id: number) {
  return `https://avatars.githubusercontent.com/u/${id}?v=4`;
}

export function startStub(port: number): Promise<http.Server> {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    const path = url.pathname;
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const authorized = request.headers.authorization === `Bearer ${USER_TOKEN}`;

    // GitHub's web sign-in: approve at once and send the user back with a code.
    if (path === "/login/oauth/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", CODE);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { Location: back.toString() });
      return response.end();
    }
    if (path === "/login/oauth/access_token" && request.method === "POST") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw) as { client_id?: string; client_secret?: string; code?: string };
      if (body.client_id !== CLIENT_ID || body.client_secret !== CLIENT_SECRET || body.code !== CODE) {
        return json(200, { error: "bad_verification_code", error_description: "The code passed is incorrect." });
      }
      return json(200, { access_token: USER_TOKEN, expires_in: 28_800, token_type: "bearer" });
    }

    // The npm registry's abbreviated package document.
    if (path.startsWith("/npm/")) {
      const pkg = PACKAGES[decodeURIComponent(path.slice("/npm/".length))];
      if (!pkg) return json(404, { error: "Not found" });
      return json(200, {
        "dist-tags": { latest: pkg.latest },
        versions: Object.fromEntries(pkg.versions.map((version) => [version, {}])),
      });
    }

    // GitHub's REST API. The API's own calls use GITHUB_TOKEN, any non-empty token.
    if (path === "/user") {
      if (!authorized) return json(401, { message: "Bad credentials" });
      return json(200, { login: LOGIN, id: 1, name: "Octo E2E", avatar_url: avatar(1) });
    }
    if (path === "/user/installations") {
      if (!authorized) return json(401, { message: "Bad credentials" });
      return json(200, {
        total_count: 1,
        installations: [
          {
            id: INSTALLATION_ID,
            account: { login: "acme", avatar_url: avatar(2), type: "Organization", html_url: "https://github.com/acme" },
            repository_selection: "selected",
            html_url: `https://github.com/organizations/acme/settings/installations/${INSTALLATION_ID}`,
            created_at: "2026-10-01T00:00:00Z",
            suspended_at: null,
          },
        ],
      });
    }
    if (path === `/user/installations/${INSTALLATION_ID}/repositories`) {
      if (!authorized) return json(401, { message: "Bad credentials" });
      return json(200, { total_count: REPOSITORIES.length, repositories: REPOSITORIES });
    }
    const contents = path.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/package\.json$/);
    if (contents) {
      const manifest = PACKAGE_JSON[contents[1]];
      return manifest ? json(200, manifest) : json(404, { message: "Not Found" });
    }
    const repo = REPOSITORIES.find((candidate) => path === `/repos/${candidate.full_name}`);
    if (repo) return json(200, { ...repo, clone_url: `https://github.com/${repo.full_name}.git` });

    json(404, { message: "Not Found" });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
