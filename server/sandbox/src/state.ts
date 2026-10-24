import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * The refactor and test phases run in separate containers, so anything one
 * needs from the other travels through the shared volume. Test output is far
 * too large to pass as an environment variable.
 */
const BREAKING_CHANGES_FILE = 'breaking-changes.md';
const TEST_OUTPUT_FILE = 'test-output.txt';
const VALIDATION_FAILURE_FILE = 'validation-failure.txt';
const VALIDATE_BASELINE_FILE = 'validate-baseline.json';

async function write(stateDir: string, name: string, contents: string): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, name), contents, 'utf8');
}

async function read(stateDir: string, name: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(stateDir, name), 'utf8');
  } catch {
    return undefined;
  }
}

export function writeBreakingChanges(stateDir: string, contents: string): Promise<void> {
  return write(stateDir, BREAKING_CHANGES_FILE, contents);
}

export function readBreakingChanges(stateDir: string): Promise<string | undefined> {
  return read(stateDir, BREAKING_CHANGES_FILE);
}

export function writeTestOutput(stateDir: string, contents: string): Promise<void> {
  return write(stateDir, TEST_OUTPUT_FILE, contents);
}

export function readTestOutput(stateDir: string): Promise<string | undefined> {
  return read(stateDir, TEST_OUTPUT_FILE);
}

export function clearTestOutput(stateDir: string): Promise<void> {
  return fs.rm(path.join(stateDir, TEST_OUTPUT_FILE), { force: true });
}

export function writeValidationFailure(stateDir: string, contents: string): Promise<void> {
  return write(stateDir, VALIDATION_FAILURE_FILE, contents);
}

export function readValidationFailure(stateDir: string): Promise<string | undefined> {
  return read(stateDir, VALIDATION_FAILURE_FILE);
}

export function clearValidationFailure(stateDir: string): Promise<void> {
  return fs.rm(path.join(stateDir, VALIDATION_FAILURE_FILE), { force: true });
}

/**
 * Repository code can rewrite this file, so a reader must check it against
 * the digest the worker kept from the run that wrote it.
 */
export function writeValidateBaseline(stateDir: string, contents: string): Promise<void> {
  return write(stateDir, VALIDATE_BASELINE_FILE, contents);
}

export function readValidateBaseline(stateDir: string): Promise<string | undefined> {
  return read(stateDir, VALIDATE_BASELINE_FILE);
}
