import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody is what the GitHub signature is computed over; the parsed body is
  // not byte-identical and cannot be used to verify the HMAC.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
