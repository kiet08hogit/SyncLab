import { AppService } from './app.service';

describe('AppService', () => {
  it('returns the greeting served at the root route', () => {
    expect(new AppService().getHello()).toBe('Hello World!');
  });
});
