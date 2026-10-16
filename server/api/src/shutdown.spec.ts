import { onProcessSignal } from './shutdown';

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('onProcessSignal', () => {
  it('exits 0 after the application context closes', async () => {
    const exit = jest.fn();
    const handler = onProcessSignal(() => Promise.resolve(), exit);

    handler();
    await flush();

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 when close fails, instead of leaving the rejection unhandled', async () => {
    const exit = jest.fn();
    const handler = onProcessSignal(() => Promise.reject(new Error('close failed')), exit);

    handler();
    await flush();

    expect(exit).toHaveBeenCalledWith(1);
  });
});
