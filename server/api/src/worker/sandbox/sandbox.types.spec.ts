import { RESULT_SENTINEL, parsePhaseResult, type PhaseResult } from './sandbox.types';

const RESULT: PhaseResult = {
  phase: 'publish',
  ok: true,
  steps: [{ step: 'PR', output: 'opened' }],
  data: { pullRequestUrl: 'https://github.com/acme/widgets/pull/7' },
};

describe('parsePhaseResult', () => {
  it('extracts the result from surrounding container output', () => {
    const logs = ['npm notice', `${RESULT_SENTINEL}${JSON.stringify(RESULT)}`, ''].join('\n');
    expect(parsePhaseResult(logs)).toEqual(RESULT);
  });

  it('prefers the last sentinel so repository output cannot shadow the real result', () => {
    const spoofed = { ...RESULT, ok: false };
    const logs = [
      `${RESULT_SENTINEL}${JSON.stringify(spoofed)}`,
      `${RESULT_SENTINEL}${JSON.stringify(RESULT)}`,
    ].join('\n');

    expect(parsePhaseResult(logs)?.ok).toBe(true);
  });

  it('returns undefined when the sandbox died before reporting', () => {
    expect(parsePhaseResult('Killed\n')).toBeUndefined();
  });

  it('returns undefined rather than throwing on malformed output', () => {
    expect(parsePhaseResult(`${RESULT_SENTINEL}{not json`)).toBeUndefined();
  });
});
