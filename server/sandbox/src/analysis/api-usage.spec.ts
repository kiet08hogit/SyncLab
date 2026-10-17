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
