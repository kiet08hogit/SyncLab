import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  readRescanContext,
  recordRescanBaseline,
  rescan,
  type RescanChange,
  type RescanContext,
} from './rescan.js';

const RETIRED = 'claude-3-opus-20240229';

const retiredOpus: RescanChange = {
  provider: 'anthropic',
  kind: 'model_retired',
  operation: null,
  field: RETIRED,
};

const retiredSonnet: RescanChange = {
  provider: 'anthropic',
  kind: 'model_retired',
  operation: null,
  field: 'claude-3-sonnet-20240229',
};

function chat(model: string): string {
  return [
    "import Anthropic from '@anthropic-ai/sdk';",
    'const client = new Anthropic();',
    'export function ask(text: string) {',
    `  return client.messages.create({ model: ${model}, max_tokens: 512, messages: [{ role: 'user', content: text }] });`,
    '}',
  ].join('\n');
}

describe('rescan', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-rescan-'));
    await fs.mkdir(path.join(repoDir, 'src'));
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  const write = async (file: string, contents: string) => {
    await fs.mkdir(path.dirname(path.join(repoDir, file)), { recursive: true });
    await fs.writeFile(path.join(repoDir, file), contents, 'utf8');
  };

  async function migrate(context: RescanContext, after: Record<string, string>) {
    const baseline = await recordRescanBaseline(repoDir, context, ['src/chat.ts']);
    for (const [file, contents] of Object.entries(after)) {
      await write(file, contents);
    }
    return rescan(repoDir, context, JSON.parse(JSON.stringify(baseline)));
  }

  it('rejects a tree that still sends the retired model, even though nothing else changed', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));

    const reason = await migrate({ target: retiredOpus, removed: [] }, {
      'src/chat.ts': `// migrated\n${chat(`'${RETIRED}'`)}`,
    });

    assert.equal(reason, `src/chat.ts (line 5) still sends the retired model ${RETIRED}.`);
  });

  it('passes once the retired model is replaced', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));

    const reason = await migrate({ target: retiredOpus, removed: [] }, {
      'src/chat.ts': chat("'claude-opus-4-1'"),
    });

    assert.equal(reason, undefined);
  });

  it('rejects hiding the retired model behind a value only known at runtime', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));

    const reason = await migrate({ target: retiredOpus, removed: [] }, {
      'src/chat.ts': chat('process.env.MODEL'),
    });

    assert.equal(
      reason,
      `src/chat.ts (line 4) builds part of its request at runtime, so the re-scan cannot show it no longer sends the retired model ${RETIRED}.`,
    );
  });

  it('keeps a runtime-only call that was already there before the migration', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));
    await write('src/other.ts', chat('process.env.MODEL'));

    const reason = await migrate({ target: retiredOpus, removed: [] }, {
      'src/chat.ts': chat("'claude-opus-4-1'"),
    });

    assert.equal(reason, undefined);
  });

  it('rejects a migration that newly sends another retired model', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));

    const reason = await migrate({ target: retiredOpus, removed: [retiredSonnet] }, {
      'src/chat.ts': chat("'claude-3-sonnet-20240229'"),
    });

    assert.equal(
      reason,
      'src/chat.ts (line 4) newly sends the retired model claude-3-sonnet-20240229: 1 call(s) now, 0 before the migration.',
    );
  });

  it('leaves a retired model the repository already used elsewhere to its own migration', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));
    await write('src/legacy.ts', chat("'claude-3-sonnet-20240229'"));

    const reason = await migrate({ target: retiredOpus, removed: [retiredSonnet] }, {
      'src/chat.ts': chat("'claude-opus-4-1'"),
    });

    assert.equal(reason, undefined);
  });

  it('rejects a removed parameter that is still sent, and passes once it is gone', async () => {
    const removedParam: RescanChange = {
      provider: 'openai',
      kind: 'param_removed',
      operation: 'POST /v1/chat/completions',
      field: 'functions',
    };
    const call = (extra: string) =>
      [
        "import OpenAI from 'openai';",
        'const client = new OpenAI();',
        `export const ask = () => client.chat.completions.create({ model: 'gpt-4o', messages: []${extra} });`,
      ].join('\n');
    await write('src/chat.ts', call(', functions: []'));

    const still = await migrate({ target: removedParam, removed: [] }, {
      'src/chat.ts': call(', functions: [], temperature: 0'),
    });
    assert.equal(
      still,
      'src/chat.ts (line 3) still sends functions, which POST /v1/chat/completions no longer accepts.',
    );

    await write('src/chat.ts', call(', functions: []'));
    const fixed = await migrate({ target: removedParam, removed: [] }, {
      'src/chat.ts': call(', tools: []'),
    });
    assert.equal(fixed, undefined);
  });

  it('ignores the same model sent to another provider', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));

    const reason = await migrate({ target: { ...retiredOpus, provider: 'openai' }, removed: [] }, {});

    assert.equal(reason, undefined);
  });

  it('rejects a file that no longer parses, but not one that never did', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));
    await write('src/broken.ts', 'export const = ;');

    const reason = await migrate({ target: retiredOpus, removed: [] }, {
      'src/chat.ts': `${chat("'claude-opus-4-1'")}\nexport const = ;`,
    });

    assert.equal(
      reason,
      'src/chat.ts no longer parses, so the re-scan cannot show its API calls are fixed.',
    );
  });

  it('ignores files that repository scripts generated after the clone, such as build output', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));
    await write('src/legacy.ts', chat("'claude-3-sonnet-20240229'"));

    const reason = await migrate({ target: retiredOpus, removed: [retiredSonnet] }, {
      'src/chat.ts': chat("'claude-opus-4-1'"),
      // What `"prepare": "tsc"` with `outDir: "lib"` leaves behind on install.
      'lib/chat.js': chat(`'${RETIRED}'`),
      'lib/legacy.js': chat("'claude-3-sonnet-20240229'"),
      'lib/bundle.js': 'export const = ;',
    });

    assert.equal(reason, undefined);
  });

  it('records the cloned files, and only the hits the re-scan compares', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));
    await write('src/config.ts', chat('process.env.MODEL'));

    const baseline = await recordRescanBaseline(repoDir, { target: retiredOpus, removed: [retiredSonnet] }, [
      'src/chat.ts',
    ]);

    assert.deepEqual(baseline?.files, ['src/chat.ts', 'src/config.ts']);
    assert.deepEqual(
      Object.keys(baseline?.hits ?? {})
        .map((key) => JSON.parse(key) as unknown[])
        .map(([, , , field, file, confidence]) => `${String(field)} ${String(file)} ${String(confidence)}`)
        .sort(),
      [`${RETIRED} src/chat.ts confirmed`, `${RETIRED} src/config.ts possible`],
    );
  });

  it('refuses to record a baseline when the retired model is sent from a file the impact record does not list', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));
    await write('src/new.ts', `${chat(`'${RETIRED}'`)}\nexport const again = () => client.messages.create({ model: '${RETIRED}', max_tokens: 1, messages: [] });`);

    await assert.rejects(recordRescanBaseline(repoDir, { target: retiredOpus, removed: [] }, ['src/chat.ts']), {
      message: `src/new.ts (line 4, 6) sends the retired model ${RETIRED}, but the impact record does not list it: the default branch moved since the scan, and the refactor only sends the files the scan found. Re-scan the repository, then migrate again.`,
    });
  });

  it('records a baseline when the unlisted match of the target is only known at runtime, or is another removal', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));
    await write('src/config.ts', chat('process.env.MODEL'));
    await write('src/legacy.ts', chat("'claude-3-sonnet-20240229'"));

    const baseline = await recordRescanBaseline(repoDir, { target: retiredOpus, removed: [retiredSonnet] }, [
      'src/chat.ts',
    ]);

    assert.ok(baseline);
  });

  it('records a dependency migration baseline whatever files send a removal', async () => {
    await write('src/legacy.ts', chat("'claude-3-sonnet-20240229'"));

    assert.ok(await recordRescanBaseline(repoDir, { target: null, removed: [retiredSonnet] }, []));
  });

  it('passes without a baseline when there is nothing to compare', async () => {
    await write('src/chat.ts', chat(`'${RETIRED}'`));

    assert.equal(await recordRescanBaseline(repoDir, undefined, []), undefined);
    assert.equal(await rescan(repoDir, undefined, undefined), undefined);
  });

  it('refuses to judge a tree without the baseline recorded before the migration', async () => {
    await assert.rejects(
      rescan(repoDir, { target: retiredOpus, removed: [] }, undefined),
      /no re-scan baseline/,
    );
  });
});

describe('readRescanContext', () => {
  it('is undefined when the worker sent no rescan entry, or an empty one', () => {
    assert.equal(readRescanContext(undefined), undefined);
    assert.equal(readRescanContext('{}'), undefined);
    assert.equal(readRescanContext('{"rescan":{"target":null,"removed":[]}}'), undefined);
  });

  it('reads the target and the other removals', () => {
    const context = { target: retiredOpus, removed: [retiredSonnet] };
    assert.deepEqual(readRescanContext(JSON.stringify({ rescan: context })), context);
  });

  it('rejects a malformed entry rather than passing it', () => {
    assert.throws(
      () => readRescanContext('{"rescan":{"target":{"kind":"model_retired"},"removed":[]}}'),
      /malformed rescan entry/,
    );
  });
});
