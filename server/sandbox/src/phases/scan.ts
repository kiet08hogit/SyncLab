import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadWorkspace } from '../config.js';
import { collectSourceFiles } from '../files.js';
import { scanApiUsage, type SourceFile } from '../analysis/api-usage.js';
import type { PhaseResult } from '../result.js';

// Far past any hand-written module. Files this large are bundles or generated
// code, which would only slow the parse down.
const MAX_FILE_BYTES = 1_000_000;

/** The files a scan parses, and the ones too large to parse. */
export async function readSourceFiles(
  repoDir: string,
): Promise<{ files: SourceFile[]; skipped: string[] }> {
  const files: SourceFile[] = [];
  const skipped: string[] = [];

  for (const absolutePath of await collectSourceFiles(repoDir)) {
    const relativePath = path.relative(repoDir, absolutePath).split(path.sep).join('/');
    const { size } = await fs.stat(absolutePath);

    if (size > MAX_FILE_BYTES) {
      skipped.push(relativePath);
      continue;
    }

    files.push({ path: relativePath, contents: await fs.readFile(absolutePath, 'utf8') });
  }

  return { files, skipped };
}

/**
 * Records every call the repository makes to the Anthropic or OpenAI API. It
 * only parses files, so it needs no token and no network, and nothing from the
 * repository runs. The usages travel back to the worker in the result.
 */
export async function scan(): Promise<PhaseResult> {
  const { repoDir } = loadWorkspace();
  const { files, skipped } = await readSourceFiles(repoDir);
  const { usages, unparsed } = scanApiUsage(files);
  const lines = [`Scanned ${files.length} source file(s) and found ${usages.length} API call(s).`];

  for (const usage of usages) {
    const call = usage.style === 'sdk' ? usage.method : 'HTTP';
    lines.push(
      `${usage.file}:${usage.line} ${usage.provider} ${call} -> ${usage.operation ?? 'unknown operation'}`,
    );
  }

  for (const file of skipped) {
    lines.push(`Skipped ${file} (over ${MAX_FILE_BYTES} bytes)`);
  }

  for (const file of unparsed) {
    lines.push(`Could not parse ${file}`);
  }

  return {
    phase: 'scan',
    ok: true,
    steps: [{ step: 'SCAN', output: lines.join('\n') }],
    data: { usages, unparsed, skipped },
  };
}
