import type { SandboxMigration } from '../sandbox.types';
import { rescanContext, type RescanChange } from './rescan';
import { schemaContext } from './schema';
import { typecheckContext } from './typecheck';

/** What the worker reads from the database for the checks. */
export interface ValidationInputs {
  /** Confirmed retirements and removals other than the change being migrated. */
  removedChanges: RescanChange[];
}

/**
 * JSON handed to the validate phase as VALIDATE_CONTEXT.
 * Each check owns the function in this directory that adds its keys, so the
 * checks do not edit the phase list, the retry loop, or the container options.
 */
export function buildValidationContext(
  migration: SandboxMigration,
  inputs: ValidationInputs,
): string {
  return JSON.stringify({
    ...rescanContext(migration, inputs.removedChanges),
    ...schemaContext(migration),
    ...typecheckContext(migration),
  });
}
