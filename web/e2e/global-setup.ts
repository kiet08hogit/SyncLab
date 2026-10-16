import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";

import { API_PORT, STUB_PORT, WEB_PORT } from "./ports";
import { CLIENT_ID, CLIENT_SECRET, startStub } from "./stub";

// Brings up the whole stack the dashboard talks to: throwaway PostgreSQL and
// Redis containers, the real API (gateway only, so queued jobs stay QUEUED),
// the production build of the web app, and the stub in ./stub.ts. Its own
// Redis keeps a local dev worker from picking up the tests' jobs.

const WEB_DIR = path.resolve(__dirname, "..");
const API_DIR = path.resolve(WEB_DIR, "../server/api");
// The binaries themselves, so a stop signal reaches the server and npx can never download a stand-in.
const NEXT = path.join(WEB_DIR, "node_modules/.bin/next");
const PRISMA = path.join(API_DIR, "node_modules/.bin/prisma");
const RUN = `${process.pid}`;
const PG = `synclab-e2e-pg-${RUN}`;
const REDIS = `synclab-e2e-redis-${RUN}`;

type Env = Record<string, string>;

function run(command: string, args: string[], options: { cwd?: string; env?: Env } = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    throw new Error(`${command} ${args.join(" ")} failed:\n${(stdout + stderr).slice(-4_000)}`);
  }
}

/** The host port Docker bound for a container port, so parallel runs never collide. */
function hostPort(container: string, port: number): string {
  return run("docker", ["port", container, `${port}/tcp`]).split("\n")[0].split(":").at(-1)!;
}

// Set by teardown, so only a server that dies mid-run reports its output.
let stopping = false;

async function until(what: string, ready: () => Promise<boolean> | boolean, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await (async () => ready())().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what} did not become ready within ${timeoutMs / 1000}s`);
}

const answers = (url: string) => async () => (await fetch(url)).status < 500;

/** Starts a server where nothing answers yet and waits until it does at url, failing fast if it exits first. */
async function serve(name: string, command: string, args: string[], cwd: string, env: Env, url: string): Promise<ChildProcess> {
  if (await fetch(url).then(() => true, () => false)) {
    throw new Error(`${name}: something already answers at ${url}, likely a leftover server; stop it first`);
  }
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  // Quiet unless it fails, then the output says why.
  let output = "";
  const keep = (chunk: Buffer) => (output = (output + chunk).slice(-20_000));
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let started = false;
  const exited = new Promise<never>((_, reject) =>
    child.on("exit", (code, signal) => {
      const message = `${name} exited with ${code ?? signal}:\n${output}`;
      if (!started) reject(new Error(message));
      else if (!stopping) console.error(`[e2e] ${message}`);
    }),
  );
  try {
    await Promise.race([until(name, answers(url)), exited]);
  } catch (error) {
    child.kill();
    throw error;
  }
  started = true;
  return child;
}

export default async function globalSetup() {
  const children: ChildProcess[] = [];
  const containers = [PG, REDIS];
  let stub: Awaited<ReturnType<typeof startStub>> | undefined;
  const teardown = async () => {
    stopping = true;
    for (const child of children) child.kill();
    stub?.close();
    // Exits non-zero for a container that never started, which is fine here.
    spawnSync("docker", ["rm", "-f", ...containers], { stdio: "ignore" });
  };

  try {
    // "127.0.0.1::5432" lets Docker pick a free host port.
    const postgresEnv = ["POSTGRES_USER=admin", "POSTGRES_PASSWORD=password", "POSTGRES_DB=synclab"].flatMap((v) => ["-e", v]);
    run("docker", ["run", "-d", "--rm", "--name", PG, "-p", "127.0.0.1::5432", ...postgresEnv, "postgres:15"]);
    run("docker", ["run", "-d", "--rm", "--name", REDIS, "-p", "127.0.0.1::6379", "redis:7"]);
    const databaseUrl = `postgresql://admin:password@127.0.0.1:${hostPort(PG, 5432)}/synclab`;
    const redisPort = hostPort(REDIS, 6379);
    await until("PostgreSQL", () => {
      run("docker", ["exec", PG, "pg_isready", "-U", "admin", "-d", "synclab", "-h", "127.0.0.1"]);
      return true;
    });

    run(PRISMA, ["migrate", "deploy"], { cwd: API_DIR, env: { DATABASE_URL: databaseUrl } });
    run("npm", ["run", "build"], { cwd: API_DIR });

    const githubUrl = `http://127.0.0.1:${STUB_PORT}`;
    const webEnv = {
      SYNCLAB_API_URL: `http://127.0.0.1:${API_PORT}`,
      GITHUB_URL: githubUrl,
      GITHUB_API_URL: githubUrl,
      NPM_REGISTRY_URL: `${githubUrl}/npm`,
      GITHUB_CLIENT_ID: CLIENT_ID,
      GITHUB_CLIENT_SECRET: CLIENT_SECRET,
      GITHUB_APP_SLUG: "synclab-e2e",
      SESSION_SECRET: "e2e-session-secret",
    };
    run(NEXT, ["build"], { cwd: WEB_DIR, env: webEnv });

    stub = await startStub(STUB_PORT);
    children.push(
      await serve("api", "node", ["dist/main.js"], API_DIR, {
        DATABASE_URL: databaseUrl,
        REDIS_HOST: "127.0.0.1",
        REDIS_PORT: redisPort,
        PORT: `${API_PORT}`,
        APP_ROLE: "gateway",
        GITHUB_API_URL: githubUrl,
        GITHUB_TOKEN: "e2e-installation-token",
      }, `http://127.0.0.1:${API_PORT}/`),
    );
    children.push(await serve("web", NEXT, ["start", "-p", `${WEB_PORT}`], WEB_DIR, webEnv, `http://127.0.0.1:${WEB_PORT}/`));

    // Read by the tests, which run in worker processes that inherit this environment.
    process.env.E2E_PG_CONTAINER = PG;
    process.env.E2E_REDIS_CONTAINER = REDIS;
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
