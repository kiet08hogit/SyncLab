import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scanApiUsage, type SourceFile } from './api-usage.js';

function files(entries: Record<string, string>): SourceFile[] {
  return Object.entries(entries).map(([path, contents]) => ({ path, contents }));
}

function calls(entries: Record<string, string>) {
  return scanApiUsage(files(entries)).usages.map(({ file, line, method, operation }) => ({
    file,
    line,
    method,
    operation,
  }));
}

describe('scanApiUsage', () => {
  it('records an SDK call with its request keys and literal model', () => {
    const { usages } = scanApiUsage(
      files({
        'src/summarize.ts': [
          "import Anthropic from '@anthropic-ai/sdk';",
          'const client = new Anthropic();',
          'export async function summarize(text: string) {',
          "  return client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 512, messages: [{ role: 'user', content: text }] });",
          '}',
        ].join('\n'),
      }),
    );

    assert.deepEqual(usages, [
      {
        provider: 'anthropic',
        file: 'src/summarize.ts',
        line: 4,
        style: 'sdk',
        method: 'messages.create',
        operation: 'POST /v1/messages',
        params: ['max_tokens', 'messages', 'model'],
        modelIds: ['claude-haiku-4-5'],
        dynamic: false,
      },
    ]);
  });

  it('follows a client from a factory in another module, as SyncLab builds its own', () => {
    const { usages } = scanApiUsage(
      files({
        'src/llm/model.ts': [
          "import Anthropic from '@anthropic-ai/sdk';",
          'export function createAnthropicClient(): Anthropic {',
          '  return new Anthropic({ apiKey: process.env.KEY });',
          '}',
        ].join('\n'),
        'src/llm/chain.ts': [
          "import { createAnthropicClient } from './model.js';",
          'export function createChain(model: string) {',
          '  const client = createAnthropicClient();',
          '  return () => client.beta.messages.stream({ model, max_tokens: 64000, messages: [] });',
          '}',
        ].join('\n'),
      }),
    );

    assert.equal(usages.length, 1);
    assert.deepEqual(
      { ...usages[0] },
      {
        provider: 'anthropic',
        file: 'src/llm/chain.ts',
        line: 4,
        style: 'sdk',
        method: 'beta.messages.stream',
        operation: 'POST /v1/messages',
        params: ['max_tokens', 'messages', 'model'],
        modelIds: [],
        // The model is a parameter, so only runtime knows it.
        dynamic: true,
      },
    );
  });

  it('follows CommonJS exports, namespaces, and barrel re-exports', () => {
    assert.deepEqual(
      calls({
        'lib/openai.js': [
          "const OpenAI = require('openai');",
          'const openai = new OpenAI();',
          'module.exports = { openai };',
        ].join('\n'),
        'lib/chat.js': [
          "const { openai } = require('./openai');",
          "exports.ask = (q) => openai.chat.completions.create({ model: 'gpt-4o', messages: [q] });",
        ].join('\n'),
        'src/clients/factory.ts': [
          "import { OpenAI } from 'openai';",
          'export const makeClient = () => new OpenAI();',
        ].join('\n'),
        'src/clients/index.ts': "export { makeClient } from './factory';",
        'src/embed.ts': [
          "import * as clients from './clients';",
          "export const embed = (input: string) => clients.makeClient().embeddings.create({ model: 'text-embedding-3-small', input });",
        ].join('\n'),
      }),
      [
        { file: 'lib/chat.js', line: 2, method: 'chat.completions.create', operation: 'POST /v1/chat/completions' },
        { file: 'src/embed.ts', line: 2, method: 'embeddings.create', operation: 'POST /v1/embeddings' },
      ],
    );
  });

  it('reads a client kept on a decorated class, as a NestJS service does', () => {
    assert.deepEqual(
      calls({
        'src/ai.service.ts': [
          "import { Injectable } from '@nestjs/common';",
          "import OpenAI from 'openai';",
          '@Injectable()',
          'export class AiService {',
          '  private readonly client = new OpenAI();',
          '  reply(input: string) {',
          "    return this.client.responses.create({ model: 'gpt-5', input });",
          '  }',
          '}',
        ].join('\n'),
      }),
      [{ file: 'src/ai.service.ts', line: 7, method: 'responses.create', operation: 'POST /v1/responses' }],
    );
  });

  it('sees through withOptions, and keeps a call it has no operation for', () => {
    assert.deepEqual(
      calls({
        'src/agent.ts': [
          "import Anthropic from '@anthropic-ai/sdk';",
          'const client = new Anthropic();',
          'client.withOptions({ maxRetries: 5 }).messages.countTokens({ model: "claude-opus-5-5", messages: [] });',
          'client.beta.skills.list();',
        ].join('\n'),
      }),
      [
        { file: 'src/agent.ts', line: 3, method: 'messages.countTokens', operation: 'POST /v1/messages/count_tokens' },
        { file: 'src/agent.ts', line: 4, method: 'beta.skills.list', operation: null },
      ],
    );
  });

  it('records raw HTTP calls to the provider hosts', () => {
    const { usages } = scanApiUsage(
      files({
        'src/http.ts': [
          "import axios from 'axios';",
          "const BASE = 'https://api.openai.com/v1';",
          'export function complete(prompt: string) {',
          '  return fetch(`${BASE}/chat/completions`, {',
          "    method: 'POST',",
          "    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }),",
          '  });',
          '}',
          'export function file(id: string) {',
          '  return axios.get(`https://api.anthropic.com/v1/files/${id}`);',
          '}',
        ].join('\n'),
      }),
    );

    assert.deepEqual(
      usages.map(({ provider, line, style, operation, params, modelIds, dynamic }) => ({
        provider,
        line,
        style,
        operation,
        params,
        modelIds,
        dynamic,
      })),
      [
        {
          provider: 'openai',
          line: 4,
          style: 'http',
          operation: 'POST /v1/chat/completions',
          params: ['messages', 'model'],
          modelIds: ['gpt-4o-mini'],
          dynamic: false,
        },
        {
          provider: 'anthropic',
          line: 10,
          style: 'http',
          operation: 'GET /v1/files/{param}',
          params: [],
          modelIds: [],
          dynamic: false,
        },
      ],
    );
  });

  it('records query parameter names from a fetch URL and from axios params', () => {
    const { usages } = scanApiUsage(
      files({
        'src/query.ts': [
          "import axios from 'axios';",
          'const query = { limit: 10 };',
          'const n = 10;',
          'export function calls(opts: object) {',
          "  fetch('https://api.openai.com/v1/files?limit=10');",
          "  fetch('https://api.openai.com/v1/files');",
          '  fetch(`https://api.openai.com/v1/files?limit=${n}`);',
          '  fetch(`https://api.openai.com/v1/files?${n}`);',
          "  fetch('https://api.openai.com/v1/chat/completions?limit=10', {",
          "    method: 'POST',",
          "    body: JSON.stringify({ model: 'gpt-4o', messages: [] }),",
          '  });',
          "  axios.get('https://api.openai.com/v1/files', { params: { limit: 10 } });",
          "  axios.get('https://api.openai.com/v1/files', { params: query });",
          "  axios.get('https://api.openai.com/v1/files?order=asc', { params: { limit: 10 } });",
          "  axios.post('https://api.openai.com/v1/files', { purpose: 'assistants' }, { params: { limit: 10 } });",
          "  axios({ url: 'https://api.openai.com/v1/files', method: 'get', params: { limit: 10 } });",
          "  axios.get('https://api.openai.com/v1/files', opts);",
          "  axios.get('https://api.openai.com/v1/files', { params: { limit: 10, ...opts } });",
          "  axios('https://api.openai.com/v1/files', { params: { limit: 10 } });",
          "  axios.request({ url: 'https://api.openai.com/v1/files', params: { limit: 10 } });",
          '}',
        ].join('\n'),
      }),
    );

    assert.deepEqual(
      usages.map(({ line, operation, params, modelIds, dynamic }) => ({
        line,
        operation,
        params,
        modelIds,
        dynamic,
      })),
      [
        { line: 5, operation: 'GET /v1/files', params: ['limit'], modelIds: [], dynamic: false },
        { line: 6, operation: 'GET /v1/files', params: [], modelIds: [], dynamic: false },
        { line: 7, operation: 'GET /v1/files', params: ['limit'], modelIds: [], dynamic: false },
        { line: 8, operation: 'GET /v1/files', params: [], modelIds: [], dynamic: true },
        {
          line: 9,
          operation: 'POST /v1/chat/completions',
          params: ['limit', 'messages', 'model'],
          modelIds: ['gpt-4o'],
          dynamic: false,
        },
        { line: 13, operation: 'GET /v1/files', params: ['limit'], modelIds: [], dynamic: false },
        { line: 14, operation: 'GET /v1/files', params: ['limit'], modelIds: [], dynamic: false },
        { line: 15, operation: 'GET /v1/files', params: ['limit', 'order'], modelIds: [], dynamic: false },
        { line: 16, operation: 'POST /v1/files', params: ['limit', 'purpose'], modelIds: [], dynamic: false },
        { line: 17, operation: 'GET /v1/files', params: ['limit'], modelIds: [], dynamic: false },
        { line: 18, operation: 'GET /v1/files', params: [], modelIds: [], dynamic: true },
        { line: 19, operation: 'GET /v1/files', params: ['limit'], modelIds: [], dynamic: true },
        { line: 20, operation: 'GET /v1/files', params: ['limit'], modelIds: [], dynamic: false },
        { line: 21, operation: 'GET /v1/files', params: ['limit'], modelIds: [], dynamic: false },
      ],
    );
  });

  it('records header names from a fetch init and from an axios config', () => {
    const { usages } = scanApiUsage(
      files({
        'src/headers.ts': [
          "import axios from 'axios';",
          "const headers = { 'X-Trace': '1' };",
          'export function calls(opts: object) {',
          "  fetch('https://api.openai.com/v1/items/1', { method: 'POST', headers: { 'X-Trace': '1' }, body: JSON.stringify({ model: 'gpt-4o' }) });",
          "  fetch('https://api.openai.com/v1/items/1', { method: 'POST', body: JSON.stringify({ model: 'gpt-4o' }) });",
          "  fetch('https://api.openai.com/v1/files?limit=10', { headers: { 'X-Trace': '1', Authorization: 'Bearer x' } });",
          "  fetch('https://api.openai.com/v1/files', { headers });",
          "  fetch('https://api.openai.com/v1/files', { headers: { 'X-Trace': '1', ...opts } });",
          "  fetch('https://api.openai.com/v1/files', { headers: opts });",
          "  fetch('https://api.openai.com/v1/files');",
          "  axios.post('https://api.openai.com/v1/items/1', { model: 'gpt-4o' }, { headers: { 'X-Trace': '1' } });",
          "  axios.get('https://api.openai.com/v1/files', { headers: { 'X-Trace': '1' }, params: { limit: 10 } });",
          "  axios.put('https://api.openai.com/v1/files', { purpose: 'assistants' }, { headers });",
          "  axios.patch('https://api.openai.com/v1/files/1', { purpose: 'assistants' }, { headers: { 'X-Trace': '1' }, params: { limit: 10 } });",
          "  axios.delete('https://api.openai.com/v1/files/1', { headers: { 'X-Trace': '1' } });",
          "  axios({ url: 'https://api.openai.com/v1/files', method: 'get', headers: { 'X-Trace': '1' } });",
          "  axios('https://api.openai.com/v1/files', { headers: { 'X-Trace': '1' } });",
          "  axios.request({ url: 'https://api.openai.com/v1/files', headers: { 'X-Trace': '1' } });",
          "  axios.post('https://api.openai.com/v1/files', { purpose: 'assistants' }, { headers: { 'X-Trace': '1', ...opts } });",
          "  axios.get('https://api.openai.com/v1/files', opts);",
          '}',
        ].join('\n'),
      }),
    );

    assert.deepEqual(
      usages.map(({ line, operation, params, modelIds, dynamic }) => ({
        line,
        operation,
        params,
        modelIds,
        dynamic,
      })),
      [
        {
          line: 4,
          operation: 'POST /v1/items/1',
          params: ['X-Trace', 'model'],
          modelIds: ['gpt-4o'],
          dynamic: false,
        },
        { line: 5, operation: 'POST /v1/items/1', params: ['model'], modelIds: ['gpt-4o'], dynamic: false },
        {
          line: 6,
          operation: 'GET /v1/files',
          params: ['Authorization', 'X-Trace', 'limit'],
          modelIds: [],
          dynamic: false,
        },
        { line: 7, operation: 'GET /v1/files', params: ['X-Trace'], modelIds: [], dynamic: false },
        { line: 8, operation: 'GET /v1/files', params: ['X-Trace'], modelIds: [], dynamic: true },
        { line: 9, operation: 'GET /v1/files', params: [], modelIds: [], dynamic: true },
        { line: 10, operation: 'GET /v1/files', params: [], modelIds: [], dynamic: false },
        {
          line: 11,
          operation: 'POST /v1/items/1',
          params: ['X-Trace', 'model'],
          modelIds: ['gpt-4o'],
          dynamic: false,
        },
        { line: 12, operation: 'GET /v1/files', params: ['X-Trace', 'limit'], modelIds: [], dynamic: false },
        { line: 13, operation: 'PUT /v1/files', params: ['X-Trace', 'purpose'], modelIds: [], dynamic: false },
        {
          line: 14,
          operation: 'PATCH /v1/files/1',
          params: ['X-Trace', 'limit', 'purpose'],
          modelIds: [],
          dynamic: false,
        },
        { line: 15, operation: 'DELETE /v1/files/1', params: ['X-Trace'], modelIds: [], dynamic: false },
        { line: 16, operation: 'GET /v1/files', params: ['X-Trace'], modelIds: [], dynamic: false },
        { line: 17, operation: 'GET /v1/files', params: ['X-Trace'], modelIds: [], dynamic: false },
        { line: 18, operation: 'GET /v1/files', params: ['X-Trace'], modelIds: [], dynamic: false },
        { line: 19, operation: 'POST /v1/files', params: ['X-Trace', 'purpose'], modelIds: [], dynamic: true },
        { line: 20, operation: 'GET /v1/files', params: [], modelIds: [], dynamic: true },
      ],
    );
  });

  it('marks a request it cannot read in full as dynamic', () => {
    const { usages } = scanApiUsage(
      files({
        'src/requests.ts': [
          "import OpenAI from 'openai';",
          'const client = new OpenAI();',
          "const base = { model: 'gpt-4o' };",
          "const fixed = { model: 'gpt-4o', input: 'hi' };",
          "client.responses.create({ ...base, input: 'hi' });",
          'client.responses.create(fixed);',
          'client.responses.create(buildRequest());',
        ].join('\n'),
      }),
    );

    assert.deepEqual(
      usages.map(({ line, params, modelIds, dynamic }) => ({ line, params, modelIds, dynamic })),
      [
        { line: 5, params: ['input'], modelIds: [], dynamic: true },
        { line: 6, params: ['input', 'model'], modelIds: ['gpt-4o'], dynamic: false },
        { line: 7, params: [], modelIds: [], dynamic: true },
      ],
    );
  });

  it('reads HTTP options bound to a const, and never guesses a method it cannot read', () => {
    const { usages } = scanApiUsage(
      files({
        'src/http.ts': [
          "import axios from 'axios';",
          "const URL = 'https://api.openai.com/v1/chat/completions';",
          "const init = { method: 'POST', body: JSON.stringify({ model: 'gpt-4o', messages: [] }) };",
          'fetch(URL, init);',
          'export function send(verb: string, opts: RequestInit) {',
          "  fetch(URL, { method: verb, body: JSON.stringify({ model: 'gpt-4o' }) });",
          '  fetch(URL, opts);',
          '  fetch(URL, { ...opts });',
          "  axios(URL, { method: 'post', data: { model: 'gpt-4o' } });",
          '  axios.request(opts);',
          '  fetch(URL);',
          '}',
        ].join('\n'),
      }),
    );

    assert.deepEqual(
      usages.map(({ line, operation, params, modelIds, dynamic }) => ({ line, operation, params, modelIds, dynamic })),
      [
        { line: 4, operation: 'POST /v1/chat/completions', params: ['messages', 'model'], modelIds: ['gpt-4o'], dynamic: false },
        { line: 6, operation: null, params: ['model'], modelIds: ['gpt-4o'], dynamic: true },
        { line: 7, operation: null, params: [], modelIds: [], dynamic: true },
        { line: 8, operation: null, params: [], modelIds: [], dynamic: true },
        { line: 9, operation: 'POST /v1/chat/completions', params: ['model'], modelIds: ['gpt-4o'], dynamic: false },
        { line: 11, operation: 'GET /v1/chat/completions', params: [], modelIds: [], dynamic: false },
      ],
    );
  });

  it('follows optional chaining to the client and its methods', () => {
    assert.deepEqual(
      calls({
        'src/optional.ts': [
          "import Anthropic from '@anthropic-ai/sdk';",
          "import axios from 'axios';",
          'const client = new Anthropic();',
          'class Service {',
          '  private client?: Anthropic = new Anthropic();',
          '  run() {',
          "    return this.client?.messages.create({ model: 'claude-opus-5-5', max_tokens: 1, messages: [] });",
          '  }',
          '}',
          "client.messages?.create({ model: 'claude-opus-5-5', max_tokens: 1, messages: [] });",
          'client?.withOptions({ maxRetries: 1 })?.messages.countTokens({ model: "claude-opus-5-5", messages: [] });',
          "axios?.get('https://api.anthropic.com/v1/models');",
        ].join('\n'),
      }),
      [
        { file: 'src/optional.ts', line: 7, method: 'messages.create', operation: 'POST /v1/messages' },
        { file: 'src/optional.ts', line: 10, method: 'messages.create', operation: 'POST /v1/messages' },
        { file: 'src/optional.ts', line: 11, method: 'messages.countTokens', operation: 'POST /v1/messages/count_tokens' },
        { file: 'src/optional.ts', line: 12, method: undefined, operation: 'GET /v1/models' },
      ],
    );
  });

  it('follows a client from an .mts module imported as .mjs', () => {
    assert.deepEqual(
      calls({
        'src/model.mts': [
          "import Anthropic from '@anthropic-ai/sdk';",
          'export const client = new Anthropic();',
          "client.models.list();",
        ].join('\n'),
        'src/chain.mts': [
          "import { client } from './model.mjs';",
          "client.messages.create({ model: 'claude-opus-5-5', max_tokens: 1, messages: [] });",
        ].join('\n'),
      }),
      [
        { file: 'src/chain.mts', line: 2, method: 'messages.create', operation: 'POST /v1/messages' },
        { file: 'src/model.mts', line: 3, method: 'models.list', operation: 'GET /v1/models' },
      ],
    );
  });

  it('follows an anonymous default-exported factory', () => {
    assert.deepEqual(
      calls({
        'src/client.ts': [
          "import OpenAI from 'openai';",
          'export default function () {',
          '  return new OpenAI();',
          '}',
        ].join('\n'),
        'src/use.ts': [
          "import create from './client.js';",
          "create().responses.create({ model: 'gpt-5', input: 'hi' });",
        ].join('\n'),
      }),
      [{ file: 'src/use.ts', line: 2, method: 'responses.create', operation: 'POST /v1/responses' }],
    );
  });

  it('ignores the API named in text, look-alike objects, and a local fetch', () => {
    const { usages } = scanApiUsage(
      files({
        'src/notes.ts': [
          '// client.messages.create({ model: "claude-opus-5-5" })',
          "export const docs = 'Calls go to https://api.openai.com/v1/responses.';",
          'const inbox = { messages: { create: (m: string) => m } };',
          "inbox.messages.create('hello');",
        ].join('\n'),
        'src/mock.ts': [
          'const fetch = (url: string) => Promise.resolve(url);',
          "fetch('https://api.anthropic.com/v1/messages');",
        ].join('\n'),
      }),
    );

    assert.deepEqual(usages, []);
  });

  it('reports a file it cannot parse instead of dropping it silently', () => {
    const result = scanApiUsage(
      files({
        'src/broken.ts': '<<<<<<< HEAD\nconst a = 1;',
        'src/ok.ts': 'export const a = 1;',
      }),
    );

    assert.deepEqual(result, { usages: [], unparsed: ['src/broken.ts'] });
  });
});
