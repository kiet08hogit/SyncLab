import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  extractIds,
  extractTables,
  normalizeTables,
  parseDate,
  parseDeprecations,
} from './deprecations';

/** Pages recorded from the providers (the Anthropic pair from the Wayback Machine). */
function recorded(name: string): string {
  return gunzipSync(readFileSync(join(__dirname, 'fixtures', name))).toString('utf8');
}

function contentOf(name: string): string {
  return normalizeTables(extractTables(recorded(name)));
}

describe('parseDeprecations on recorded pages', () => {
  // Anthropic announced Claude Sonnet 4.5's retirement on 2026-09-30, between these captures.
  const before = parseDeprecations(contentOf('anthropic-deprecations-2026-09-26.html.gz'));
  const after = parseDeprecations(contentOf('anthropic-deprecations-2026-10-01.html.gz'));

  it('reads the one retirement Anthropic announced between the two captures', () => {
    const known = new Set(before.changes.map((change) => change.field));
    const added = after.changes.filter((change) => !known.has(change.field));

    expect(added).toEqual([
      {
        kind: 'model_retired',
        operation: null,
        field: 'claude-sonnet-4-5-20250929',
        replacement: 'claude-sonnet-5-5',
        effectiveAt: '2026-11-30',
        section: '2026-09-30: Claude Sonnet 4.5 model',
        evidence: 'November 30, 2026 | claude-sonnet-4-5-20250929 | claude-sonnet-5-5',
      },
    ]);
    expect(before.changes).toHaveLength(19);
    expect(after.changes).toHaveLength(20);
  });

  it('reads the same retirements identically from both captures', () => {
    const afterByField = new Map(after.changes.map((change) => [change.field, change]));
    for (const change of before.changes) {
      expect(afterByField.get(change.field)).toEqual(change);
    }
  });

  it('ignores the status overview, whose dates are only tentative', () => {
    // claude-fable-5-1 is listed as active with "Not sooner than ..." in the overview.
    expect(after.changes.map((change) => change.field)).not.toContain('claude-fable-5-1');
    expect(after.changes.every((change) => change.effectiveAt !== null)).toBe(true);
  });

  it('only reports evidence that is a whole line of the snapshot', () => {
    const content = contentOf('anthropic-deprecations-2026-10-01.html.gz');
    const lines = new Set(content.split('\n'));
    for (const change of after.changes) {
      expect(lines.has(change.evidence)).toBe(true);
    }
  });

  describe('the OpenAI page', () => {
    const openai = parseDeprecations(contentOf('openai-deprecations-2026-10-17.html.gz'));

    it('splits a display name with several snapshots into one change per model ID', () => {
      const gpt4o = openai.changes.filter((change) =>
        change.evidence.startsWith('January 14, 2027 | GPT-4o ('),
      );
      expect(gpt4o.map((change) => change.field)).toEqual([
        'gpt-4o-2024-08-06',
        'gpt-4o-2024-11-20',
      ]);
      expect(gpt4o.every((change) => change.replacement === 'gpt-6-luna')).toBe(true);
    });

    it('records retired endpoints by path', () => {
      expect(
        openai.changes
          .filter((change) => change.kind === 'endpoint_removed')
          .map((change) => change.operation),
      ).toEqual([
        '/v1/audio/translations',
        '/v1/fine-tunes',
        '/v1/edits',
        '/v1/engines',
        '/v1/search',
        '/v1/classifications',
        '/v1/answers',
      ]);
    });

    it('skips rows that retire a product or capability rather than a model', () => {
      // "New fine-tuning training on babbage-002" does not retire babbage-002 itself.
      expect(openai.skipped).toEqual([
        '2026-09-24 | Videos API | —',
        '2026‑05‑12 | OpenAI-Beta: realtime=v1 | Realtime API',
        '2026‑08‑26 | Assistants API | Responses API and Conversations API',
        '2024-12-18 | OpenAI-Beta: assistants=v1 | OpenAI-Beta: assistants=v2',
        '2024-10-28 | New fine-tuning training on babbage-002 | gpt-4o-mini',
        '2024-10-28 | New fine-tuning training on davinci-002 | gpt-4o-mini',
      ]);
      expect(openai.changes.map((change) => change.field)).not.toContain('fine-tuning');
    });

    it('reports each model once even when several tables mention it', () => {
      const keys = openai.changes.map(
        (change) => `${change.kind}:${change.operation}:${change.field}`,
      );
      expect(new Set(keys).size).toBe(keys.length);
      expect(openai.changes).toHaveLength(161);
    });
  });
});

describe('normalizeTables', () => {
  it('ignores page chrome that changes on every request', () => {
    const table =
      '<h2>2026-01-01: Old model</h2><table><tr><th>Retirement date</th><th>Deprecated model</th></tr><tr><td>Jan 1, 2027</td><td>old-model-1</td></tr></table>';
    const first = `<script>window.__BUILD__="a1"</script><style>.x{}</style>${table}<footer>nonce 123</footer>`;
    const second = `<script>window.__BUILD__="b2"</script>${table}<footer>nonce 456</footer>`;

    expect(normalizeTables(extractTables(first))).toBe(normalizeTables(extractTables(second)));
  });

  it('keeps a pipe inside a cell from splitting the row', () => {
    const html =
      '<h2>Models</h2><table><tr><th>Shutdown date</th><th>Model</th></tr><tr><td>Jan 1, 2027</td><td>o1-2024-12-17 | o1</td></tr></table>';
    const { changes } = parseDeprecations(normalizeTables(extractTables(html)));

    expect(changes.map((change) => change.field)).toEqual(['o1-2024-12-17', 'o1']);
  });
});

describe('parseDate', () => {
  it.each([
    ['November 30, 2026', '2026-11-30'],
    ['Apr 1, 2027', '2027-04-01'],
    ['Sept. 30, 2026', '2026-09-30'],
    ['2026-09-28', '2026-09-28'],
    ['2026‑05‑12', '2026-05-12'],
  ])('reads %s', (text, expected) => {
    expect(parseDate(text)).toBe(expected);
  });

  it.each(['To be announced', 'Not sooner than June 9, 2027', 'February 30, 2027', ''])(
    'gives no date for %j',
    (text) => {
      expect(parseDate(text)).toBeNull();
    },
  );
});

describe('extractIds', () => {
  it.each([
    ['claude-3-haiku-20240307', ['claude-3-haiku-20240307']],
    ['GPT-4.1 mini (gpt-4.1-mini-2025-04-14)', ['gpt-4.1-mini-2025-04-14']],
    [
      'gpt-4-0125-preview (including gpt-4-turbo-preview and gpt-4-turbo-preview-completions, which point to this snapshot)',
      ['gpt-4-0125-preview', 'gpt-4-turbo-preview', 'gpt-4-turbo-preview-completions'],
    ],
    ['/v1/edits', ['/v1/edits']],
    ['Assistants API', []],
    ['New fine-tuning training on davinci-002', []],
  ])('reads %j', (cell, expected) => {
    expect(extractIds(cell)).toEqual(expected);
  });
});
