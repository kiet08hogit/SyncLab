import type { SandboxMigration } from '../sandbox.types';

/**
 * The request schemas the OpenAI schema check holds literal request objects against.
 * A later change fills this from the new spec snapshot. An empty object means
 * the check has nothing to reject.
 */
export function schemaContext(migration: SandboxMigration): Record<string, unknown> {
  // No request schema is passed until the OpenAI schema check reads the new spec.
  void migration;
  return {};
}
