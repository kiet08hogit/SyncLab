import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emitResult, RESULT_SENTINEL, type PhaseResult } from './result.js';

function captureStdout(fn: () => void): string {
  const original = process.stdout.write;
  let captured = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}

describe('emitResult', () => {
  it('prints the result as JSON on its own sentinel line', () => {
    const result: PhaseResult = {
      phase: 'test',
      ok: false,
      error: 'test suite failed with exit code 1',
      steps: [{ step: 'TEST', output: 'line one\nline two', exitCode: 1 }],
      data: { attempt: 2 },
    };

    const output = captureStdout(() => emitResult(result));
    const lines = output.split('\n');
    const resultLine = lines.find((line) => line.startsWith(RESULT_SENTINEL));

    assert.ok(output.startsWith('\n'), 'the sentinel must not share a line with earlier output');
    assert.ok(output.endsWith('\n'));
    assert.ok(resultLine);
    assert.deepEqual(JSON.parse(resultLine.slice(RESULT_SENTINEL.length)), result);
  });
});
