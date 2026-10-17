export type SpecChangeKind =
  'endpoint_removed' | 'param_removed' | 'param_now_required' | 'enum_value_removed';

export interface SpecChange {
  kind: SpecChangeKind;
  /** METHOD plus the server base path and the path, such as "POST /v1/agents/sessions". */
  operation: string;
  /** The parameter name, "name=value" for a removed enum value, null for a removed endpoint. */
  field: string | null;
  replacement: null;
  effectiveAt: null;
  section: string;
  /**
   * The verbatim surface line that proves the change: the previous line for a
   * removal, the current line for a parameter that became required.
   */
  evidence: string;
}

type Schema = Record<string, unknown>;

const SECTION = 'OpenAPI spec';
const SEPARATOR = ' | ';
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'];
const BODY_TYPES = ['application/json', 'multipart/form-data'];

function isObject(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Follows a local "#/..." reference, or gives null when it points nowhere. */
function lookup(spec: Schema, ref: string): Schema | null {
  if (!ref.startsWith('#/')) return null;
  let node: unknown = spec;
  for (const part of ref.slice(2).split('/')) {
    if (!isObject(node)) return null;
    node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return isObject(node) ? node : null;
}

/**
 * Follows a chain of $refs. `seen` holds the refs already being resolved on
 * the current path, so a schema that refers back to itself ends the walk
 * instead of recursing forever.
 */
function resolve(spec: Schema, node: unknown, seen: Set<string>): [Schema | null, Set<string>] {
  let current = node;
  let path = seen;
  while (isObject(current) && typeof current.$ref === 'string') {
    if (path.has(current.$ref)) return [null, path];
    path = new Set(path).add(current.$ref);
    current = lookup(spec, current.$ref);
  }
  return [isObject(current) ? current : null, path];
}

function isNullSchema(schema: Schema): boolean {
  const { type } = schema;
  return type === 'null' || (Array.isArray(type) && type.length === 1 && type[0] === 'null');
}

function enumText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * The values a schema restricts a value to, or null when it accepts anything
 * else too. A oneOf/anyOf is only restricted when every non-null branch is,
 * so OpenAI's "any string, or one of these known model IDs" stays open and
 * dropping a known ID from it is not reported as breaking.
 */
function enumValues(spec: Schema, node: unknown, seen: Set<string>): string[] | null {
  const [schema, path] = resolve(spec, node, seen);
  if (!schema) return null;
  if (Array.isArray(schema.enum)) return schema.enum.map(enumText);

  const branches = [schema.oneOf, schema.anyOf].find(Array.isArray);
  if (branches) {
    const values: string[] = [];
    for (const branch of branches as unknown[]) {
      const [resolved] = resolve(spec, branch, path);
      if (resolved && isNullSchema(resolved)) continue;
      const branchValues = enumValues(spec, branch, path);
      if (!branchValues) return null;
      values.push(...branchValues);
    }
    return values.length > 0 ? values : null;
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf as unknown[]) {
      const values = enumValues(spec, branch, path);
      if (values) return values;
    }
  }
  return null;
}

interface Param {
  required: boolean;
  enum: string[] | null;
}

interface BodyFields {
  properties: Map<string, unknown>;
  required: Set<string>;
}

/**
 * The top-level properties of a request body schema. Only the top level is
 * read: a property nested inside an object field (such as spend_control.limit)
 * is out of scope, so removing or tightening one is not reported.
 */
function bodyFields(spec: Schema, node: unknown, seen: Set<string>): BodyFields {
  const fields: BodyFields = { properties: new Map(), required: new Set() };
  const [schema, path] = resolve(spec, node, seen);
  if (!schema) return fields;

  const merge = (other: BodyFields) => {
    for (const [name, property] of other.properties) {
      if (!fields.properties.has(name)) fields.properties.set(name, property);
    }
    for (const name of other.required) fields.required.add(name);
  };

  if (isObject(schema.properties)) {
    for (const [name, property] of Object.entries(schema.properties)) {
      fields.properties.set(name, property);
    }
  }
  if (Array.isArray(schema.required)) {
    for (const name of schema.required) {
      if (typeof name === 'string') fields.required.add(name);
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf as unknown[]) merge(bodyFields(spec, branch, path));
  }

  // A caller may send any branch, so a property is required only when every branch requires it.
  for (const branches of [schema.oneOf, schema.anyOf]) {
    if (!Array.isArray(branches)) continue;
    const parts = (branches as unknown[])
      .filter((branch) => {
        const [resolved] = resolve(spec, branch, path);
        return resolved !== null && !isNullSchema(resolved);
      })
      .map((branch) => bodyFields(spec, branch, path));
    if (parts.length === 0) continue;
    merge({
      properties: new Map(parts.flatMap((part) => [...part.properties])),
      required: new Set(
        [...parts[0].required].filter((name) => parts.every((part) => part.required.has(name))),
      ),
    });
  }

  return fields;
}

/** The path of servers[0].url without a trailing slash, such as "/v1". */
function basePath(spec: Schema): string {
  const server: unknown = Array.isArray(spec.servers) ? spec.servers[0] : undefined;
  if (!isObject(server) || typeof server.url !== 'string') return '';
  try {
    return new URL(server.url, 'http://localhost').pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** The query, path and header parameters, with the operation's overriding the path item's. */
function declaredParams(spec: Schema, pathItem: Schema, operation: Schema): Map<string, Param> {
  const byLocation = new Map<string, Schema>();
  for (const list of [pathItem.parameters, operation.parameters]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list as unknown[]) {
      const [param] = resolve(spec, entry, new Set());
      if (!param || typeof param.name !== 'string') continue;
      byLocation.set(`${String(param.in)}:${param.name}`, param);
    }
  }

  const params = new Map<string, Param>();
  for (const param of byLocation.values()) {
    const name = param.name as string;
    if (params.has(name)) continue;
    params.set(name, {
      required: param.required === true,
      enum: enumValues(spec, param.schema ?? param, new Set()),
    });
  }
  return params;
}

function bodyParams(spec: Schema, operation: Schema): Map<string, Param> {
  const params = new Map<string, Param>();
  const [requestBody] = resolve(spec, operation.requestBody, new Set());
  if (!requestBody || !isObject(requestBody.content)) return params;
  const content = requestBody.content;
  const media = BODY_TYPES.map((type) => content[type]).find(isObject);
  if (!media) return params;

  const fields = bodyFields(spec, media.schema, new Set());
  for (const [name, property] of fields.properties) {
    params.set(name, {
      required: fields.required.has(name),
      enum: enumValues(spec, property, new Set()),
    });
  }
  return params;
}

/**
 * Names and enum values are written as they are, so one containing " | " or
 * ", " would read back split in two. OpenAI's spec has none.
 */
function paramLine(operation: string, name: string, param: Param): string {
  let line = `${operation}${SEPARATOR}param ${name}`;
  if (param.required) line += `${SEPARATOR}required`;
  if (param.enum) line += `${SEPARATOR}enum ${[...new Set(param.enum)].sort().join(', ')}`;
  return line;
}

/**
 * The request surface of an OpenAPI document: one line per operation and one
 * per parameter a caller can send it, sorted. This is what a snapshot stores
 * and hashes, so response-only edits and description rewords never register
 * as a change, and every piece of evidence is a whole line of it.
 */
export function extractSurface(spec: unknown): string {
  if (!isObject(spec) || typeof spec.openapi !== 'string' || !isObject(spec.paths)) {
    throw new Error('Not an OpenAPI document with paths');
  }
  const base = basePath(spec);
  const lines: string[] = [];

  for (const [path, item] of Object.entries(spec.paths)) {
    const [pathItem] = resolve(spec, item, new Set());
    if (!pathItem) continue;
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!isObject(operation)) continue;
      const name = `${method.toUpperCase()} ${base}${path}`;
      lines.push(name);

      // Declared parameters win over a body property of the same name.
      const params = declaredParams(spec, pathItem, operation);
      for (const [param, value] of bodyParams(spec, operation)) {
        if (!params.has(param)) params.set(param, value);
      }
      for (const [param, value] of params) lines.push(paramLine(name, param, value));
    }
  }

  return [...new Set(lines)].sort().join('\n');
}

interface SurfaceParam extends Param {
  line: string;
}

interface Surface {
  operations: Set<string>;
  params: Map<string, SurfaceParam>;
}

function paramKey(operation: string, name: string): string {
  return `${operation}\n${name}`;
}

function parseSurface(content: string): Surface {
  const surface: Surface = { operations: new Set(), params: new Map() };
  for (const line of content.split('\n')) {
    if (line === '') continue;
    const [operation, ...parts] = line.split(SEPARATOR);
    if (parts.length === 0) {
      surface.operations.add(operation);
      continue;
    }
    const name = parts[0].slice('param '.length);
    const enumPart = parts.find((part) => part.startsWith('enum '));
    surface.params.set(paramKey(operation, name), {
      line,
      required: parts.includes('required'),
      enum: enumPart ? enumPart.slice('enum '.length).split(', ') : null,
    });
  }
  return surface;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The breaking request-side changes between two surfaces (the output of
 * extractSurface). Additions are never breaking, and a removed endpoint is
 * reported once rather than once more for each of its parameters.
 */
export function diffSurfaces(previous: string, current: string): SpecChange[] {
  const before = parseSurface(previous);
  const after = parseSurface(current);
  const changes: SpecChange[] = [];
  const change = (
    kind: SpecChangeKind,
    operation: string,
    field: string | null,
    evidence: string,
  ) => {
    changes.push({
      kind,
      operation,
      field,
      replacement: null,
      effectiveAt: null,
      section: SECTION,
      evidence,
    });
  };

  for (const operation of before.operations) {
    if (!after.operations.has(operation)) change('endpoint_removed', operation, null, operation);
  }

  for (const [key, old] of before.params) {
    const [operation, name] = key.split('\n');
    if (!after.operations.has(operation)) continue;
    const now = after.params.get(key);
    if (!now) {
      change('param_removed', operation, name, old.line);
      continue;
    }
    if (!old.required && now.required) change('param_now_required', operation, name, now.line);
    if (old.enum && now.enum) {
      const kept = new Set(now.enum);
      for (const value of old.enum) {
        if (!kept.has(value)) change('enum_value_removed', operation, `${name}=${value}`, old.line);
      }
    }
  }

  return changes.sort(
    (a, b) =>
      compare(a.operation, b.operation) ||
      compare(a.kind, b.kind) ||
      compare(a.field ?? '', b.field ?? ''),
  );
}
