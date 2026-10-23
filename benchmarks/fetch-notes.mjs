// Snapshots the release notes production would give the model for each case.
// prepare calls fetchReleaseNotes (npm registry -> GitHub release for the
// target tag) and falls back to a fixed sentence; this runs the same code once
// and stores the result, so every benchmark run feeds the model identical
// notes and none of it depends on GitHub at run time.
//
// Needs a GitHub token for the API rate limit: GITHUB_TOKEN, or `gh auth token`.
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { argSet, isApiChange, loadCases, notesDir, root } from './lib/sandbox.mjs';

const sandboxRequire = createRequire(path.join(root, 'server', 'sandbox', 'package.json'));
const { Octokit } = await import(sandboxRequire.resolve('@octokit/rest'));
const { fetchReleaseNotes } = await import(path.join(root, 'server', 'sandbox', 'dist', 'changelog.js'));

const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const octokit = new Octokit({ auth: token });
const refresh = process.argv.includes('--refresh');

// An API change has no release to read: its brief travels with the job.
const cases = (await loadCases(argSet('only'))).filter((spec) => !isApiChange(spec));
await fs.mkdir(notesDir, { recursive: true });
const indexFile = path.join(notesDir, 'index.json');
const index = JSON.parse(await fs.readFile(indexFile, 'utf8').catch(() => '{}'));

for (const spec of cases) {
  const file = path.join(notesDir, `${spec.id}.md`);
  if (!refresh && (await fs.access(file).then(() => true, () => false))) {
    continue;
  }
  const notes = await fetchReleaseNotes(octokit, spec.package, spec.toVersion).catch(() => undefined);
  // The exact fallback prepare writes when nothing is found.
  const text = notes ?? `No release notes were found for ${spec.package} ${spec.toVersion}.`;
  await fs.writeFile(file, text.endsWith('\n') ? text : `${text}\n`);
  index[spec.id] = {
    package: spec.package,
    toVersion: spec.toVersion,
    found: notes !== undefined,
    characters: notes?.length ?? 0,
    fetchedAt: new Date().toISOString(),
  };
  console.log(`${spec.id}: ${notes ? `${notes.length} characters` : 'no release notes'}`);
}

const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(indexFile, `${JSON.stringify(sorted, null, 2)}\n`);
