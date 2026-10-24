import { z } from 'zod';
import { SDK_REQUEST_OPTIONS, scanRequestObjects, type RequestObject } from '../../analysis/api-usage.js';
import { loadWorkspace } from '../../config.js';
import { readSourceFiles } from '../../phases/scan.js';
import type { ValidateCheck } from '../load-checks.js';

const OpenaiSchemaSchema = z.object({
  /** The files the migration rewrote. Requests elsewhere are not the migration's to fix. */
  files: z.array(z.string()),
  /** Each operation of the new spec, such as "POST /v1/responses", with its parameter names. */
  operations: z.record(
    z.string(),
    z.object({ params: z.array(z.string()), required: z.array(z.string()) }),
  ),
});

export type OpenaiSchema = z.infer<typeof OpenaiSchemaSchema>;

const ContextSchema = z.object({ openaiSchema: OpenaiSchemaSchema.optional() });

const PATH_PARAM = /\{([^}]+)\}/g;

/** An SDK path says {response_id} where a raw URL only says {param}, so names are dropped. */
function operationKey(operation: string): string {
  return operation.replace(PATH_PARAM, '{}');
}

interface CheckedOperation {
  params: string[];
  required: string[];
  path: Set<string>;
}

/**
 * The spec operation a call names. An exact key wins, so a static path such
 * as POST /v1/agents/sessions is not read as POST /v1/agents/{agent_id}.
 * Otherwise a template is used only when it is the only one whose `{}`
 * segments each cover one segment of the call.
 */
function specForOperation(
  operations: Map<string, CheckedOperation>,
  operation: string,
): CheckedOperation | undefined {
  const key = operationKey(operation);
  const exact = operations.get(key);
  if (exact) {
    return exact;
  }

  let matched: CheckedOperation | undefined;
  for (const [template, spec] of operations) {
    if (!templateFits(template, key)) {
      continue;
    }
    if (matched) {
      return undefined;
    }
    matched = spec;
  }
  return matched;
}

/** Each `{}` of a spec template covers one segment of the called path. */
function templateFits(template: string, concrete: string): boolean {
  if (!template.includes('{}')) {
    return false;
  }
  const expected = template.split('/');
  const actual = concrete.split('/');
  if (expected.length !== actual.length) {
    return false;
  }
  return expected.every((part, index) => part === '{}' || part === actual[index]);
}

/**
 * One line per OpenAI request object in the migrated files that does not
 * match the new spec: a key the operation does not accept (unknown or
 * removed), a required field left out, or an operation the spec no longer
 * has. A path parameter is passed positionally, so it is never required in
 * the object, and an object with a spread may carry the required fields.
 * An SDK call whose keys are all per-request options is left unchecked when
 * it leaves out no required field. An incomplete one is still left unchecked
 * when every required field is a path parameter, except a POST, PUT, or PATCH
 * whose path has no template and whose spec lists a parameter that is not a
 * path parameter.
 * A raw URL that writes a literal where a template has `{}` uses that
 * operation when exactly one template fits, and an exact operation is tried
 * first so a static path wins. When several templates fit, none is used.
 * A runtime part of a raw URL may span several segments, so such a URL that
 * matches no operation is left unchecked.
 */
export function findSchemaMismatches(requests: RequestObject[], schema: OpenaiSchema): string[] {
  const files = new Set(schema.files);
  const operations = new Map<string, CheckedOperation>(
    Object.entries(schema.operations).map(([operation, params]) => [
      operationKey(operation),
      { ...params, path: new Set([...operation.matchAll(PATH_PARAM)].map((match) => match[1])) },
    ]),
  );
  const mismatches: string[] = [];

  for (const { usage, keys, complete } of requests) {
    if (usage.provider !== 'openai' || !usage.operation || !files.has(usage.file)) {
      continue;
    }
    const where = `${usage.file}:${usage.line} ${usage.operation}`;
    const spec = specForOperation(operations, usage.operation);
    if (!spec) {
      if (usage.operation.includes('{param}')) {
        continue;
      }
      mismatches.push(`${where}: the new spec has no such operation`);
      continue;
    }

    const accepted = new Set(spec.params);
    const unknown = keys.filter((key) => !accepted.has(key));
    const sent = new Set(keys);
    const bodyRequired = spec.required.filter((name) => !spec.path.has(name));
    const missing = complete ? bodyRequired.filter((name) => !sent.has(name)) : [];
    const optionsOnly =
      usage.style === 'sdk' && keys.length > 0 && keys.every((key) => SDK_REQUEST_OPTIONS.has(key));
    const method = usage.operation.split(' ')[0];
    const untemplatedBody =
      (method === 'POST' || method === 'PUT' || method === 'PATCH') &&
      !usage.operation.includes('{') &&
      spec.params.some((name) => !spec.path.has(name));
    const skipIncomplete = bodyRequired.length === 0 && !untemplatedBody;
    if (optionsOnly && (complete ? missing.length === 0 : skipIncomplete)) {
      continue;
    }

    const problems: string[] = [];
    if (unknown.length > 0) {
      problems.push(`sends ${unknown.join(', ')}, which the new spec does not accept`);
    }
    if (missing.length > 0) {
      problems.push(`leaves out ${missing.join(', ')}, which the new spec requires`);
    }
    if (problems.length > 0) {
      mismatches.push(`${where}: ${problems.join('; ')}`);
    }
  }

  return mismatches;
}

/**
 * Holds every literal OpenAI request object in the migrated files against the
 * request schema of the new spec. With no spec in VALIDATE_CONTEXT, which is
 * every job that is not an OpenAI API change, it has nothing to reject.
 */
export const check: ValidateCheck = {
  name: 'schema',
  run: async () => {
    const { openaiSchema } = ContextSchema.parse(JSON.parse(process.env.VALIDATE_CONTEXT || '{}'));
    if (!openaiSchema) {
      return undefined;
    }
    const { files } = await readSourceFiles(loadWorkspace().repoDir);
    const mismatches = findSchemaMismatches(scanRequestObjects(files), openaiSchema);
    return mismatches.length > 0 ? mismatches.join('\n') : undefined;
  },
};
