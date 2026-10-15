import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configuration } from './config/configuration';
import { onProcessSignal } from './shutdown';

async function bootstrap() {
  const role = configuration().appRole;

  // A worker process has nothing to serve over HTTP. Skipping listen means
  // several workers can run on one machine without fighting over PORT.
  if (role === 'worker') {
    const app = await NestFactory.createApplicationContext(AppModule);
    const shutdown = onProcessSignal(
      () => app.close(),
      (code) => process.exit(code),
    );
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  // rawBody is what the GitHub signature is computed over; the parsed body is
  // not byte-identical and cannot be used to verify the HMAC.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
