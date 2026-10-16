import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from './prisma.service';

jest.mock('dotenv', () => ({ config: jest.fn() }));
// The real adapter connects lazily, so constructing it is safe; wrapping it
// only records the connection string it was given.
jest.mock('@prisma/adapter-pg', () => {
  const actual = jest.requireActual<typeof import('@prisma/adapter-pg')>('@prisma/adapter-pg');
  return {
    PrismaPg: jest.fn(
      (...args: ConstructorParameters<typeof actual.PrismaPg>) => new actual.PrismaPg(...args),
    ),
  };
});

describe('PrismaService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.mocked(PrismaPg).mockClear();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('refuses to start without DATABASE_URL', () => {
    delete process.env.DATABASE_URL;

    expect(() => new PrismaService()).toThrow('DATABASE_URL is not set');
    expect(PrismaPg).not.toHaveBeenCalled();
  });

  it('connects through the pg adapter with DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.test:5432/synclab';

    new PrismaService();

    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: 'postgresql://user:pass@db.test:5432/synclab',
    });
  });

  it('connects on module init and disconnects on module destroy', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.test:5432/synclab';
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();

    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('fails module init when the database cannot be reached', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.test:5432/synclab';
    const service = new PrismaService();
    jest.spyOn(service, '$connect').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.onModuleInit()).rejects.toThrow('ECONNREFUSED');
  });
});
