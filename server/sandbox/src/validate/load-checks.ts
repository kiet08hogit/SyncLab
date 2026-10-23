import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * One check the validate phase runs after the repository tests pass.
 * Add a file in `checks/` that exports `check`. The phase loads every such
 * file itself, so a new check does not edit the phase list, the retry loop,
 * or the container options. Read `process.env.VALIDATE_CONTEXT` for the JSON
 * the worker built for this job. Return undefined to pass, or the reason the
 * next refactor attempt must fix.
 */
export interface ValidateCheck {
  name: string;
  run: () => Promise<string | undefined>;
}

const CHECKS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'checks');

function isCheckModule(name: string): boolean {
  return name.endsWith('.js') && !name.endsWith('.spec.js') && !name.startsWith('.');
}

/**
 * Loads the checks compiled next to this module. `dir` is for tests; the
 * phase uses the directory beside this file.
 */
export async function loadChecks(dir = CHECKS_DIR): Promise<ValidateCheck[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const checks: ValidateCheck[] = [];
  for (const name of names.filter(isCheckModule).sort()) {
    try {
      const loaded = (await import(pathToFileURL(path.join(dir, name)).href)) as {
        check?: ValidateCheck;
      };
      if (loaded.check) {
        checks.push(loaded.check);
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      checks.push({ name: path.basename(name, '.js'), run: () => Promise.resolve(reason) });
    }
  }
  return checks;
}
