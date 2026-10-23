import type { SandboxMigration } from '../sandbox.types';

/**
 * The kinds that take something away, so a migration must not start using it.
 * enum_value_removed is left out: the scan does not record values, so it can
 * never show a literal use of the removed one.
 */
export const REMOVAL_KINDS = [
  'model_retired',
  'endpoint_removed',
  'param_removed',
  'param_renamed',
] as const;

/** A confirmed change, as server/sandbox/src/validate/rescan.ts reads it. */
export interface RescanChange {
  provider: string;
  kind: string;
  operation: string | null;
  field: string | null;
}

/**
 * What the re-scan check compares the migrated tree against: the change being
 * migrated, which must be gone, and every other confirmed retirement or
 * removal, which must not be newly used. An empty object means the check has
 * nothing to reject.
 */
export function rescanContext(
  migration: SandboxMigration,
  removed: RescanChange[],
): Record<string, unknown> {
  const target =
    migration.kind === 'api_change'
      ? {
          provider: migration.change.provider,
          kind: migration.change.kind,
          operation: migration.change.operation,
          field: migration.change.field,
        }
      : null;
  if (!target && removed.length === 0) return {};
  return { rescan: { target, removed } };
}
