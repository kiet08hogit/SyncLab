import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { diffSurfaces, extractSurface, requestSchemas } from './openapi-spec';

/** OpenAI's spec at a commit of github.com/openai/openai-openapi. */
function recorded(name: string): unknown {
  return JSON.parse(gunzipSync(readFileSync(join(__dirname, 'fixtures', name))).toString('utf8'));
}

/** A minimal OpenAPI document around the given paths. */
function spec(paths: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown {
  return { openapi: '3.1.0', servers: [{ url: 'https://api.example.com/v1' }], paths, ...extra };
}

function jsonBody(schema: unknown) {
  return { requestBody: { content: { 'application/json': { schema } } } };
}

function diffSpecs(previous: unknown, current: unknown) {
  return diffSurfaces(extractSurface(previous), extractSurface(current));
}

describe('extractSurface and diffSurfaces on recorded specs', () => {
  // OpenAI commit 6ca9cb2b "Remove session spending control from API" and its parent.
  const before = extractSurface(recorded('openai-openapi-35060f5b.json.gz'));
  const after = extractSurface(recorded('openai-openapi-6ca9cb2b.json.gz'));

  it('reports the request property the commit removed from both session bodies', () => {
    // The commit also dropped spend_control from SessionResource, a response, which is not reported.
    expect(diffSurfaces(before, after)).toEqual([
      {
        kind: 'param_removed',
        operation: 'POST /v1/agents/sessions',
        field: 'spend_control',
        replacement: null,
        effectiveAt: null,
        section: 'OpenAPI spec',
        evidence: 'POST /v1/agents/sessions | param spend_control',
      },
      {
        kind: 'param_removed',
        operation: 'POST /v1/agents/sessions/{session_id}',
        field: 'spend_control',
        replacement: null,
        effectiveAt: null,
        section: 'OpenAPI spec',
        evidence: 'POST /v1/agents/sessions/{session_id} | param spend_control',
      },
    ]);
  });

  it('only reports evidence that is a whole line of the previous snapshot', () => {
    const lines = new Set(before.split('\n'));
    for (const change of diffSurfaces(before, after)) {
      expect(lines.has(change.evidence)).toBe(true);
    }
  });

  it('keeps the surface of a 4.8 MB spec small', () => {
    expect(before.length).toBeLessThan(150_000);
    expect(before.split('\n')).toContain('POST /v1/agents/sessions | param environment | required');
    expect(before.split('\n')).toContain('GET /v1/agents | param order | enum asc, desc');
  });

  it('finds nothing breaking going forward to the same spec or back to the older one', () => {
    expect(diffSurfaces(after, after)).toEqual([]);
    // Re-adding spend_control is an addition, which is never breaking.
    expect(diffSurfaces(after, before)).toEqual([]);
  });
});

describe('requestSchemas', () => {
  it('lists each operation with the parameters it accepts and requires', () => {
    const surface = extractSurface(
      spec({
        '/items/{id}': {
          post: {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            ...jsonBody({
              type: 'object',
              properties: { name: {}, mode: { enum: ['a', 'b'] } },
              required: ['name'],
            }),
          },
          get: {},
        },
      }),
    );

    expect(requestSchemas(surface)).toEqual({
      'GET /v1/items/{id}': { params: [], required: [] },
      'POST /v1/items/{id}': { params: ['id', 'mode', 'name'], required: ['id', 'name'] },
    });
  });

  it('drops a removed parameter from the recorded spec that removed it', () => {
    const before = requestSchemas(extractSurface(recorded('openai-openapi-35060f5b.json.gz')));
    const after = requestSchemas(extractSurface(recorded('openai-openapi-6ca9cb2b.json.gz')));

    expect(before['POST /v1/agents/sessions'].params).toContain('spend_control');
    expect(after['POST /v1/agents/sessions'].params).not.toContain('spend_control');
  });
});

describe('extractSurface', () => {
  const paths = {
    '/b': {
      post: {
        parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
        ...jsonBody({ type: 'object', properties: { z: {}, a: {} }, required: ['z'] }),
      },
      get: {},
    },
    '/a': { delete: {} },
  };

  it('lists operations and parameters one per line, sorted', () => {
    expect(extractSurface(spec(paths)).split('\n')).toEqual([
      'DELETE /v1/a',
      'GET /v1/b',
      'POST /v1/b',
      'POST /v1/b | param a',
      'POST /v1/b | param q',
      'POST /v1/b | param z | required',
    ]);
  });

  it('gives byte-identical content for the same spec with keys in another order', () => {
    const reordered = {
      paths: {
        '/a': { delete: {} },
        '/b': {
          get: {},
          post: {
            ...jsonBody({ required: ['z'], properties: { a: {}, z: {} }, type: 'object' }),
            parameters: [{ schema: { type: 'string' }, in: 'query', name: 'q' }],
          },
        },
      },
      servers: [{ url: 'https://api.example.com/v1' }],
      openapi: '3.1.0',
    };

    expect(extractSurface(reordered)).toBe(extractSurface(spec(paths)));
  });

  it('ignores responses and descriptions', () => {
    const withResponses = spec({
      '/a': { delete: { description: 'Deletes it', responses: { 200: { description: 'ok' } } } },
      '/b': paths['/b'],
    });

    expect(extractSurface(withResponses)).toBe(extractSurface(spec(paths)));
  });

  it.each([null, 'openapi', [], {}, { openapi: '3.1.0' }, { swagger: '2.0', paths: {} }])(
    'throws on %j, which is not an OpenAPI document with paths',
    (input) => {
      expect(() => extractSurface(input)).toThrow('Not an OpenAPI document with paths');
    },
  );

  it.each([
    [[{ url: 'https://api.example.com/v1/' }], 'GET /v1/a'],
    [[{ url: '/beta' }], 'GET /beta/a'],
    [[{ url: 'https://api.example.com' }], 'GET /a'],
    [undefined, 'GET /a'],
  ])('takes the base path from servers %j', (servers, expected) => {
    expect(extractSurface({ openapi: '3.1.0', servers, paths: { '/a': { get: {} } } })).toBe(
      expected,
    );
  });

  it('resolves $refs to parameters, request bodies and schemas, and merges allOf', () => {
    const surface = extractSurface(
      spec(
        {
          '/items/{id}': {
            parameters: [{ $ref: '#/components/parameters/Id' }],
            post: {
              parameters: [{ name: 'X-Trace', in: 'header' }],
              requestBody: { $ref: '#/components/requestBodies/Update' },
            },
          },
        },
        {
          components: {
            parameters: { Id: { name: 'id', in: 'path', required: true } },
            requestBodies: {
              Update: {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Update' } },
                },
              },
            },
            schemas: {
              Base: { properties: { name: {} }, required: ['name'] },
              Update: {
                allOf: [{ $ref: '#/components/schemas/Base' }],
                properties: { color: { $ref: '#/components/schemas/Color' } },
              },
              Color: { type: 'string', enum: ['red', 'blue'] },
            },
          },
        },
      ),
    );

    expect(surface.split('\n')).toEqual([
      'POST /v1/items/{id}',
      'POST /v1/items/{id} | param X-Trace',
      'POST /v1/items/{id} | param color | enum blue, red',
      'POST /v1/items/{id} | param id | required',
      'POST /v1/items/{id} | param name | required',
    ]);
  });

  it('unions oneOf branches, requiring only what every branch requires', () => {
    const surface = extractSurface(
      spec({
        '/a': {
          post: jsonBody({
            oneOf: [
              { properties: { id: {}, url: {} }, required: ['id', 'url'] },
              { properties: { id: {}, file: {} }, required: ['id', 'file'] },
              { type: 'null' },
            ],
          }),
        },
      }),
    );

    expect(surface.split('\n')).toEqual([
      'POST /v1/a',
      'POST /v1/a | param file',
      'POST /v1/a | param id | required',
      'POST /v1/a | param url',
    ]);
  });

  it('reads a multipart body', () => {
    const surface = extractSurface(
      spec({
        '/files': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: { properties: { file: {} }, required: ['file'] },
                },
              },
            },
          },
        },
      }),
    );

    expect(surface).toBe('POST /v1/files\nPOST /v1/files | param file | required');
  });

  it('reads an enum only when every non-null branch is restricted', () => {
    const surface = extractSurface(
      spec({
        '/a': {
          post: jsonBody({
            properties: {
              order: { anyOf: [{ enum: ['desc', 'asc'] }, { type: 'null' }] },
              // Any string goes, so the known values are not a restriction.
              model: { anyOf: [{ type: 'string' }, { type: 'string', enum: ['gpt-6'] }] },
            },
          }),
        },
      }),
    );

    expect(surface.split('\n')).toEqual([
      'POST /v1/a',
      'POST /v1/a | param model',
      'POST /v1/a | param order | enum asc, desc',
    ]);
  });

  it('stops at a $ref cycle instead of recursing forever', () => {
    const surface = extractSurface(
      spec(
        { '/a': { post: jsonBody({ $ref: '#/components/schemas/Node' }) } },
        {
          components: {
            schemas: {
              Node: {
                allOf: [{ $ref: '#/components/schemas/Node' }],
                anyOf: [{ $ref: '#/components/schemas/Loop' }],
                properties: { next: { $ref: '#/components/schemas/Node' } },
              },
              Loop: { $ref: '#/components/schemas/Loop' },
            },
          },
        },
      ),
    );

    expect(surface).toBe('POST /v1/a\nPOST /v1/a | param next');
  });
});

describe('diffSurfaces', () => {
  it('reports a removed endpoint once, not once more per parameter', () => {
    const before = spec({
      '/a': { get: { parameters: [{ name: 'limit', in: 'query' }] }, post: {} },
    });
    const after = spec({ '/a': { post: {} } });

    expect(diffSpecs(before, after)).toEqual([
      {
        kind: 'endpoint_removed',
        operation: 'GET /v1/a',
        field: null,
        replacement: null,
        effectiveAt: null,
        section: 'OpenAPI spec',
        evidence: 'GET /v1/a',
      },
    ]);
  });

  it('reports a parameter that became required, with the new line as evidence', () => {
    const before = spec({ '/a': { post: jsonBody({ properties: { model: {} } }) } });
    const after = spec({
      '/a': { post: jsonBody({ properties: { model: {} }, required: ['model'] }) },
    });

    expect(diffSpecs(before, after)).toEqual([
      {
        kind: 'param_now_required',
        operation: 'POST /v1/a',
        field: 'model',
        replacement: null,
        effectiveAt: null,
        section: 'OpenAPI spec',
        evidence: 'POST /v1/a | param model | required',
      },
    ]);
  });

  it('reports each removed enum value as name=value', () => {
    const order = (values: string[]) =>
      spec({
        '/a': { get: { parameters: [{ name: 'order', in: 'query', schema: { enum: values } }] } },
      });

    expect(diffSpecs(order(['asc', 'desc', 'rand']), order(['desc', 'newest']))).toEqual([
      {
        kind: 'enum_value_removed',
        operation: 'GET /v1/a',
        field: 'order=asc',
        replacement: null,
        effectiveAt: null,
        section: 'OpenAPI spec',
        evidence: 'GET /v1/a | param order | enum asc, desc, rand',
      },
      {
        kind: 'enum_value_removed',
        operation: 'GET /v1/a',
        field: 'order=rand',
        replacement: null,
        effectiveAt: null,
        section: 'OpenAPI spec',
        evidence: 'GET /v1/a | param order | enum asc, desc, rand',
      },
    ]);
  });

  it('ignores additions and relaxations', () => {
    const before = spec({
      '/a': {
        post: jsonBody({
          properties: { model: {}, order: { enum: ['asc'] } },
          required: ['model'],
        }),
      },
    });
    const after = spec({
      '/a': {
        post: jsonBody({ properties: { model: {}, order: { type: 'string' }, extra: {} } }),
      },
      '/b': { get: {} },
    });

    expect(diffSpecs(before, after)).toEqual([]);
  });

  it('sorts changes by operation, kind and field', () => {
    const before = spec({
      '/b': {
        get: {
          parameters: [
            { name: 'y', in: 'query' },
            { name: 'x', in: 'query' },
          ],
        },
      },
      '/a': { get: {} },
      '/c': { get: { parameters: [{ name: 'z', in: 'query' }] } },
    });
    const after = spec({
      '/b': { get: {} },
      '/c': { get: { parameters: [{ name: 'z', in: 'query', required: true }] } },
    });

    expect(
      diffSpecs(before, after).map((change) => [change.kind, change.operation, change.field]),
    ).toEqual([
      ['endpoint_removed', 'GET /v1/a', null],
      ['param_removed', 'GET /v1/b', 'x'],
      ['param_removed', 'GET /v1/b', 'y'],
      ['param_now_required', 'GET /v1/c', 'z'],
    ]);
  });
});
