import type { SandboxMigration } from '../sandbox.types';
import { rescanContext } from './rescan';
import { schemaContext } from './schema';
import { typecheckContext } from './typecheck';

/**
 * JSON handed to the validate phase as VALIDATE_CONTEXT.
 * Each check owns the function in this directory that adds its keys, so the
 * checks do not edit the phase list, the retry loop, or the container options.
 */
export function buildValidationContext(migration: SandboxMigration): string {
  return JSON.stringify({
    ...rescanContext(migration),
    ...schemaContext(migration),
    ...typecheckContext(migration),
  });
}
