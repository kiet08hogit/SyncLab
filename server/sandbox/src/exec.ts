import { spawn } from 'node:child_process';

export interface CommandResult {
  code: number;
  output: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Interleaves stdout and stderr into a single buffer so the captured output
 * reads in the same order a human would see it in a terminal.
 */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const append = (chunk: Buffer) => {
      output += chunk.toString('utf8');
    };

    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, output }));
  });
}

export async function runOrThrow(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(`\`${command} ${args.join(' ')}\` exited with code ${result.code}\n${result.output}`);
  }
  return result;
}

/**
 * Credentials are supplied through a git credential file rather than argv, but
 * a misbehaving tool could still echo one. Scrub before anything is persisted.
 */
export function redact(text: string, secrets: (string | undefined)[]): string {
  return secrets.reduce<string>(
    (acc, secret) => (secret ? acc.split(secret).join('***') : acc),
    text,
  );
}
