import type { SandboxMigration } from '../sandbox.types';

/**
 * What the re-scan check compares the migrated tree against.
 * A later change fills this from the impact record and the confirmed retirements
 * and removals. An empty object means the check has nothing to reject.
 */
export function rescanContext(migration: SandboxMigration): Record<string, unknown> {
  // Nothing to compare until the re-scan check records the usages it must see gone.
  void migration;
  return {};
}
