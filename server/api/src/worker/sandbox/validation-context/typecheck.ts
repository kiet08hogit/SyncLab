import type { SandboxMigration } from '../sandbox.types';

/**
 * The SDK a TypeScript repository is typechecked against.
 * An API change that does not name one contributes nothing, and the check passes.
 */
export function typecheckContext(migration: SandboxMigration): Record<string, unknown> {
  if (migration.kind !== 'api_change' || !migration.sdk) {
    return {};
  }

  return { typecheck: { package: migration.sdk.name, version: migration.sdk.version } };
}
