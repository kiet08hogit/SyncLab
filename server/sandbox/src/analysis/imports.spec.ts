import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeDependencyUsage } from './imports.js';

describe('analyzeDependencyUsage', () => {
  it('ignores a file that never mentions the dependency', () => {
    const code = ['import path from "node:path";', 'export const dir = path.join("a", "b");'].join(
      '\n',
    );

    assert.equal(analyzeDependencyUsage(code, 'react'), undefined);
  });

  it('collects imported names and the lines where they are used', () => {
    const code = [
      'import { render, hydrate } from "react-dom";',
      '',
      'export function mount(node) {',
      '  return render(node, document.body);',
      '}',
    ].join('\n');

    const usage = analyzeDependencyUsage(code, 'react-dom');

    assert.deepEqual(usage?.importedNames, ['hydrate', 'render']);
    assert.deepEqual(usage?.usageLines, [1, 4]);
  });

  it('treats a deep entry point as the same dependency', () => {
    const code = 'import { jsx } from "react/jsx-runtime";';

    assert.deepEqual(analyzeDependencyUsage(code, 'react')?.importedNames, ['jsx']);
  });

  it('does not match a package whose name merely shares a prefix', () => {
    const code = 'import x from "react-dom";';

    assert.equal(analyzeDependencyUsage(code, 'react'), undefined);
  });

  it('handles destructured require calls', () => {
    const code = [
      'const { readFile } = require("fs-extra");',
      'readFile("a.txt");',
    ].join('\n');

    const usage = analyzeDependencyUsage(code, 'fs-extra');

    assert.deepEqual(usage?.importedNames, ['readFile']);
    assert.deepEqual(usage?.usageLines, [1, 2]);
  });

  it('records a side-effect import even though it binds no names', () => {
    const usage = analyzeDependencyUsage('import "polyfill-pkg";', 'polyfill-pkg');

    assert.deepEqual(usage?.importedNames, []);
    assert.deepEqual(usage?.usageLines, [1]);
  });

  it('parses TypeScript and JSX', () => {
    const code = [
      'import { Button, type ButtonProps } from "ui-kit";',
      'export const El = (p: ButtonProps) => <Button {...p} />;',
    ].join('\n');

    const usage = analyzeDependencyUsage(code, 'ui-kit');

    assert.deepEqual(usage?.importedNames, ['Button', 'ButtonProps']);
    assert.ok(usage?.usageLines.includes(2));
  });

  it('falls back to a substring match when the file cannot be parsed', () => {
    const usage = analyzeDependencyUsage('this ( is not { valid <<< "ui-kit"', 'ui-kit');

    assert.deepEqual(usage, { importedNames: [], usageLines: [] });
  });
});
