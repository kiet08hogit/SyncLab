#!/usr/bin/env node
// Registers the SyncLab GitHub App through GitHub's App Manifest flow and
// writes its credentials into the env files, so nobody copies secrets by hand.
//
//   node scripts/register-github-app.mjs --webhook-url https://smee.io/abc123
//
// It serves a page on http://localhost:3002 that posts a pre-filled manifest
// to GitHub. After you press "Create GitHub App", GitHub redirects back with a
// one-time code, which is exchanged for the App's id, client id and secret,
// webhook secret and private key. Secrets are written to files, never printed.

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    'webhook-url': { type: 'string' },
    name: { type: 'string', default: 'SyncLab' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help || !args['webhook-url']) {
  console.log(`Usage: node scripts/register-github-app.mjs --webhook-url <url> [--name <name>]

  --webhook-url    Where GitHub delivers webhooks: your gateway's /webhook, or a
                   smee.io channel that forwards to it (required)
  --name           App name, unique across GitHub (default "SyncLab")`);
  process.exit(args.help ? 0 : 1);
}

const port = 3002;
const dashboardUrl = 'http://localhost:3001';
const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiEnv = resolve(apiDir, '.env');
const webEnv = resolve(apiDir, '../../web/.env.local');
const state = randomBytes(16).toString('hex');

// Permissions the worker needs to clone, push a branch and open a pull request,
// and the one event the gateway acts on. Reading package.json for the trigger
// and the dashboard form is covered by contents: write.
const manifest = {
  name: args.name,
  url: dashboardUrl,
  description: 'Migrates dependency upgrades and opens them as pull requests.',
  hook_attributes: { url: args['webhook-url'], active: true },
  redirect_url: `http://localhost:${port}/created`,
  callback_urls: [`${dashboardUrl}/auth/github/callback`],
  public: false,
  default_permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' },
  default_events: ['pull_request'],
};

const createUrl = `https://github.com/settings/apps/new?state=${state}`;

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Sets KEY=value lines in an env file, keeping every other line as it was. */
function upsertEnv(path, entries) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}="${value}"`;
    const index = lines.findIndex((existing) => existing.startsWith(`${key}=`));
    if (index === -1) {
      if (lines.length && lines.at(-1) === '') lines.splice(lines.length - 1, 0, line);
      else lines.push(line);
    } else {
      lines[index] = line;
    }
  }
  writeFileSync(path, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readEnv(path, key) {
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1).replace(/^"|"$/g, '') || undefined;
}

async function convert(code) {
  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub refused the manifest code (${response.status}): ${await response.text()}`,
    );
  }
  return response.json();
}

function saveCredentials(app) {
  const pemFile = `${app.slug}.private-key.pem`;
  const pemPath = resolve(apiDir, pemFile);
  writeFileSync(pemPath, app.pem, { mode: 0o600 });
  chmodSync(pemPath, 0o600);

  upsertEnv(apiEnv, {
    GITHUB_APP_ID: String(app.id),
    GITHUB_PRIVATE_KEY_PATH: `./${pemFile}`,
    GITHUB_WEBHOOK_SECRET: app.webhook_secret,
  });
  upsertEnv(webEnv, {
    GITHUB_CLIENT_ID: app.client_id,
    GITHUB_CLIENT_SECRET: app.client_secret,
    GITHUB_APP_SLUG: app.slug,
    // Keep an existing secret so current dashboard sessions stay valid.
    SESSION_SECRET: readEnv(webEnv, 'SESSION_SECRET') ?? randomBytes(32).toString('base64'),
  });
  return pemPath;
}

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui;max-width:40rem;margin:4rem auto;line-height:1.5">${body}</body>`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);

  if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      page(
        'Register SyncLab',
        `<h1>Register the ${escapeHtml(args.name)} GitHub App</h1>
<p>GitHub shows the settings below for review. Press <b>Create GitHub App</b> there, and this page receives the credentials.</p>
<form action="${escapeHtml(createUrl)}" method="post">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<button type="submit" style="font:inherit;padding:.5rem 1rem">Continue to GitHub</button></form>`,
      ),
    );
    return;
  }

  if (url.pathname === '/created') {
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.get('state') !== state) {
      response.writeHead(400, { 'Content-Type': 'text/html' });
      response.end(
        page(
          'Registration failed',
          '<h1>Missing or mismatched code</h1><p>Start again from the first page.</p>',
        ),
      );
      return;
    }
    try {
      const app = await convert(code);
      const pemPath = saveCredentials(app);
      const installUrl = `${app.html_url}/installations/new`;
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        page(
          'SyncLab registered',
          `<h1>${escapeHtml(app.name)} is registered</h1>
<p>Credentials were written to the env files. Next, <a href="${escapeHtml(installUrl)}">install the App</a> on the repositories SyncLab should migrate.</p>`,
        ),
      );
      console.log(`Registered ${app.name} (id ${app.id}, slug ${app.slug}): ${app.html_url}`);
      console.log(
        `Wrote GITHUB_APP_ID, GITHUB_PRIVATE_KEY_PATH, GITHUB_WEBHOOK_SECRET to ${apiEnv}`,
      );
      console.log(`Wrote the private key to ${pemPath}`);
      console.log(
        `Wrote GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_APP_SLUG, SESSION_SECRET to ${webEnv}`,
      );
      console.log(`Install it: ${installUrl}`);
    } catch (error) {
      response.writeHead(502, { 'Content-Type': 'text/html' });
      response.end(
        page(
          'Registration failed',
          `<h1>Registration failed</h1><p>${escapeHtml(String(error))}</p>`,
        ),
      );
      console.error(error);
      process.exitCode = 1;
    }
    server.close();
    return;
  }

  response.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`Open http://localhost:${port} to register the GitHub App.`);
});
