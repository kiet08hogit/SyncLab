import { resolveAppRole, roleIncludesGateway, roleIncludesWorker } from './configuration';

describe('resolveAppRole', () => {
  it('defaults to all so a single process still runs gateway and worker', () => {
    expect(resolveAppRole(undefined)).toBe('all');
    expect(resolveAppRole('nope')).toBe('all');
  });

  it('accepts the split roles used to scale workers independently', () => {
    expect(resolveAppRole('gateway')).toBe('gateway');
    expect(resolveAppRole('worker')).toBe('worker');
    expect(roleIncludesGateway('gateway')).toBe(true);
    expect(roleIncludesWorker('gateway')).toBe(false);
    expect(roleIncludesGateway('worker')).toBe(false);
    expect(roleIncludesWorker('worker')).toBe(true);
  });
});
