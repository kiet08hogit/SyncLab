import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { addedSections, extractText, verifyClassified } from './release-notes';

function fixture(name: string): string {
  const data = readFileSync(join(__dirname, 'fixtures', name));
  return name.endsWith('.gz') ? gunzipSync(data).toString('utf8') : data.toString('utf8');
}

describe('extractText from HTML', () => {
  it('writes headings as "## " lines and each block as one collapsed line', () => {
    const html = `
      <html><head><title>Notes</title><style>p { color: red }</style></head><body>
        <header><a>Docs home</a></header>
        <nav><ul><li>Quickstart</li></ul></nav>
        <h2>October 1,
          2026<button aria-label="Copy link"><span></span></button></h2>
        <p>The <code>functions</code>   parameter
           was removed.</p>
        <ul>
          <li>First item
            <ul><li>Nested item</li></ul>
          </li>
        </ul>
        <table><tr><th>Model</th><th>Shutdown date</th></tr>
          <tr><td><p>gpt-4</p></td><td>2026-11-30</td></tr></table>
        <script>window.x = '<p>not text</p>';</script>
        <noscript>Enable JavaScript</noscript>
        <footer>Copyright</footer>
      </body></html>`;

    expect(extractText(html, 'html').split('\n')).toEqual([
      '## October 1, 2026',
      'The functions parameter was removed.',
      'First item',
      'Nested item',
      'Model | Shutdown date',
      'gpt-4 | 2026-11-30',
    ]);
  });

  it('keeps only the content of main when the page has one', () => {
    const html =
      '<div><ul><li>Sidebar link</li></ul></div><main><h1>Changelog</h1><p>Entry</p></main><div>After</div>';

    expect(extractText(html, 'html')).toBe('# Changelog\nEntry');
  });

  it('decodes entities', () => {
    expect(extractText('<p>service_tier: &quot;flex&quot; &amp; more</p>', 'html')).toBe(
      'service_tier: "flex" & more',
    );
  });
});

describe('extractText from markdown', () => {
  it('keeps the level of each heading as "#" marks and trims the other non-empty lines', () => {
    const markdown =
      '# Changelog\n\n## 1.2.0 (2026-10-01)\r\n\n### Features  \n\n  * **api:** add x  \n\n';

    expect(extractText(markdown, 'markdown')).toBe(
      '# Changelog\n## 1.2.0 (2026-10-01)\n### Features\n* **api:** add x',
    );
  });
});

describe('extractText on recorded pages', () => {
  const anthropic = extractText(fixture('anthropic-release-notes-2026-10-17.html.gz'), 'html');
  const openai = extractText(fixture('openai-changelog-2026-10-17.html.gz'), 'html');

  it('reads the Anthropic release notes without the page chrome', () => {
    const lines = anthropic.split('\n');

    expect(lines).toContain('### October 15, 2026');
    expect(lines).toContain(
      'We announced the deprecation of the Claude Sonnet 4.5 model (claude-sonnet-4-5-20250929), with retirement on the Claude API scheduled for November 30, 2026. We recommend migrating to Claude Sonnet 5.5. Read more in Model deprecations.',
    );
    expect(anthropic).not.toMatch(/Search docs|Copy link|[-]/);
    expect(lines.indexOf('### October 15, 2026')).toBeLessThan(
      lines.indexOf('### October 14, 2026'),
    );
  });

  it('reads the OpenAI changelog without the sidebar', () => {
    const lines = openai.split('\n');

    expect(lines[0]).toBe('# Changelog');
    expect(lines).toContain('### October, 2026');
    expect(lines).toContain(
      'The Realtime API Beta was deprecated and removed from the API on May 12, 2026. If you are still using the beta interface, migrate to the released Realtime API. See the migration guide and the full deprecations page.',
    );
    expect(lines).not.toContain('Quickstart');
  });

  it('is deterministic and leaves no blank or padded lines', () => {
    for (const [name, text] of [
      ['anthropic-release-notes-2026-10-17.html.gz', anthropic],
      ['openai-changelog-2026-10-17.html.gz', openai],
    ]) {
      expect(extractText(fixture(name), 'html')).toBe(text);
      for (const line of text.split('\n')) {
        expect(line).toBe(line.replace(/\s+/g, ' ').trim());
        expect(line).not.toBe('');
      }
    }
  });
});

describe('addedSections', () => {
  it('groups new lines under the headings above them, in page order', () => {
    const previous = '## Oct 1\nOld entry\n### Features\n* old feature';
    const current =
      'Intro\n## Oct 2\nNew entry\nAnother new entry\n## Oct 1\nOld entry\n### Features\n* new feature\n* old feature';

    expect(addedSections(previous, current)).toEqual([
      { section: '', lines: ['Intro'] },
      { section: 'Oct 2', lines: ['New entry', 'Another new entry'] },
      { section: 'Oct 1 / Features', lines: ['* new feature'] },
    ]);
  });

  it('closes deeper headings when a shallower one starts', () => {
    const current = '# Log\n## 1.1.0\n### Fixes\n* a\n## 1.0.0\n* b';

    expect(addedSections('', current)).toEqual([
      { section: 'Log / 1.1.0 / Fixes', lines: ['* a'] },
      { section: 'Log / 1.0.0', lines: ['* b'] },
    ]);
  });

  it('finds nothing when only the order changed', () => {
    expect(addedSections('## A\nx\n## B\ny', '## B\ny\n## A\nx')).toEqual([]);
  });

  it('treats every line of a first snapshot as new, which is why the caller does not classify it', () => {
    expect(addedSections('', '## A\nx')).toEqual([{ section: 'A', lines: ['x'] }]);
  });
});

describe('verifyClassified', () => {
  const snapshot = [
    '## October 1, 2026',
    'The `functions` parameter of POST /v1/chat/completions has been removed.',
  ].join('\n');
  const genuine = {
    kind: 'param_removed',
    operation: 'POST /v1/chat/completions',
    field: 'functions',
    replacement: null,
    effectiveAt: '2026-10-01',
    evidence: 'The `functions` parameter of POST /v1/chat/completions has been removed.',
  };

  it('keeps a candidate whose evidence is verbatim and fills in the stored shape', () => {
    expect(
      verifyClassified([{ ...genuine, evidence: `  ${genuine.evidence}\n` }], snapshot),
    ).toEqual({
      changes: [{ ...genuine, section: null }],
      dropped: [],
    });
  });

  it.each([
    ['not an object', 'param_removed', /not an object/],
    ['an unknown kind', { ...genuine, kind: 'param_added' }, /unknown kind/],
    [
      'evidence that is not in the snapshot',
      { ...genuine, evidence: 'The functions parameter was removed from chat.' },
      /not verbatim/,
    ],
    [
      'evidence that is too short to trust',
      { ...genuine, evidence: 'has been removed.' },
      /shorter than 20/,
    ],
    ['missing evidence', { ...genuine, evidence: undefined }, /evidence is not a string/],
    [
      'a field longer than the column',
      { ...genuine, field: 'x'.repeat(256) },
      /field is longer than 255/,
    ],
    [
      'an operation longer than the column',
      { ...genuine, operation: 'x'.repeat(256) },
      /operation is longer than 255/,
    ],
    [
      'a replacement that is not a string',
      { ...genuine, replacement: 3 },
      /replacement is not a string/,
    ],
    [
      'neither an operation nor a field',
      { ...genuine, operation: ' ', field: null },
      /neither an operation nor a field/,
    ],
  ])('drops a candidate with %s', (_label, candidate, reason) => {
    const { changes, dropped } = verifyClassified([candidate], snapshot);

    expect(changes).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].candidate).toBe(candidate);
    expect(dropped[0].reason).toMatch(reason);
  });

  it('keeps the change but not a date that is not a real one', () => {
    for (const effectiveAt of ['2026-02-30', 'Q3 2026', 20261001, '']) {
      const { changes } = verifyClassified([{ ...genuine, effectiveAt }], snapshot);
      expect(changes).toEqual([{ ...genuine, effectiveAt: null, section: null }]);
    }
  });

  it('keeps the first of two candidates about the same subject', () => {
    const { changes, dropped } = verifyClassified(
      [genuine, { ...genuine, replacement: 'tools' }],
      snapshot,
    );

    expect(changes).toHaveLength(1);
    expect(dropped).toEqual([
      expect.objectContaining({ reason: 'duplicate of an earlier change' }),
    ]);
  });
});

describe('a recorded SDK release, from changelog to verified changes', () => {
  // @anthropic-ai/sdk 0.123.0 (commit 4140e0ea) replaced the beta user
  // profiles' relationship field with access_type; 4951de02 is the commit
  // before it.
  const previous = extractText(fixture('anthropic-sdk-changelog-4951de02.md.gz'), 'markdown');
  const current = extractText(fixture('anthropic-sdk-changelog-4140e0ea.md.gz'), 'markdown');
  const commit = (sha: string) =>
    `https://github.com/anthropics/anthropic-sdk-typescript/commit/${sha}`;

  it('finds exactly the lines the release added', () => {
    expect(addedSections(previous, current)).toEqual([
      {
        section: 'Changelog / 0.123.0 (2026-09-01)',
        lines: [
          'Full Changelog: [sdk-v0.122.0...sdk-v0.123.0](https://github.com/anthropics/anthropic-sdk-typescript/compare/sdk-v0.122.0...sdk-v0.123.0)',
        ],
      },
      {
        section: 'Changelog / 0.123.0 (2026-09-01) / Features',
        lines: [
          `* **api:** beta user profiles: add external_user_onboarded_at, remove relationship in favor of access_type ([3efb1a1](${commit('3efb1a1a812e30db1da695a1a16cce50cc950cfc')}))`,
          `* **api:** manual updates ([c6f0bda](${commit('c6f0bdaff67aa65dfcb6a6e02b83e60f1de50ec7')}))`,
          `* **api:** organization compliance settings, user-profile order_by, memory-store and toolset schema updates ([8e2f0c2](${commit('8e2f0c2f7ec7edf861e40d3131939fb819113e95')}))`,
        ],
      },
      {
        section: 'Changelog / 0.123.0 (2026-09-01) / Bug Fixes',
        lines: [
          `* keep credential file access out of non-Node bundles ([ab6a4b2](${commit('ab6a4b2814f09d20da12fa8ce3592d91ef2b2f89')}))`,
        ],
      },
      {
        section: 'Changelog / 0.123.0 (2026-09-01) / Chores',
        lines: [
          `* **internal:** codegen related update ([788ea8b](${commit('788ea8bdaa1077c472041f5424e7250fefb71564')}))`,
        ],
      },
      {
        section: 'Changelog / 0.123.0 (2026-09-01) / Documentation',
        lines: [
          `* **changelog:** detail the beta files/skills GA-shape change ([#1175](https://github.com/anthropics/anthropic-sdk-typescript/issues/1175)) ([4951de0](${commit('4951de02e8322ca353592a1546f78047a7633c4a')}))`,
        ],
      },
    ]);
  });

  it("keeps the model's genuine change and drops the invented, malformed and vague ones", () => {
    const answer = JSON.parse(fixture('anthropic-sdk-changelog-0.123.0.classified.json')) as {
      changes: unknown[];
    };

    const { changes, dropped } = verifyClassified(answer.changes, current);

    expect(changes).toEqual([
      {
        kind: 'param_renamed',
        operation: null,
        field: 'relationship',
        replacement: 'access_type',
        effectiveAt: null,
        section: null,
        evidence:
          'beta user profiles: add external_user_onboarded_at, remove relationship in favor of access_type',
      },
    ]);
    expect(dropped.map((entry) => entry.reason)).toEqual([
      'evidence is not verbatim in the snapshot',
      'unknown kind "schema_changed"',
      'evidence is shorter than 20 characters',
    ]);
  });
});
