import type { SandboxMigration } from '../sandbox.types';

/**
 * The SDK version a TypeScript repository is typechecked against.
 * Nothing records that version yet, so this stays empty and the check passes.
 */
export function typecheckContext(migration: SandboxMigration): Record<string, unknown> {
  // No SDK version is recorded on a change yet, so there is nothing to typecheck against.
  void migration;
  return {};
}
