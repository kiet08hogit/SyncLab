import { ForbiddenException } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import type { Caller } from './api-auth.guard';

function setup(logins = ['operator']) {
  const metrics = { snapshot: jest.fn().mockResolvedValue({}) };
  const config = { get: () => logins };
  const controller = new OperationsController(metrics as never, config as never);
  return { controller, metrics };
}
const user = (login: string): Caller => ({ kind: 'user', login, repositories: new Map() });

describe('operations access', () => {
  it('denies global telemetry to regular users before reading metrics', async () => {
    const { controller, metrics } = setup();
    expect(() => controller.snapshot(user('viewer'))).toThrow(ForbiddenException);
    await expect(controller.scrape(user('viewer'))).rejects.toThrow(ForbiddenException);
    expect(metrics.snapshot).not.toHaveBeenCalled();
  });
  it('allows configured operators case-insensitively and service callers', async () => {
    const { controller, metrics } = setup();
    await controller.snapshot(user('OpErAtOr'));
    await controller.snapshot({ kind: 'service' });
    expect(metrics.snapshot).toHaveBeenCalledTimes(2);
  });
  it('defaults to service-only access with an empty operator list', () => {
    expect(() => setup([]).controller.snapshot(user('operator'))).toThrow(ForbiddenException);
  });
});
