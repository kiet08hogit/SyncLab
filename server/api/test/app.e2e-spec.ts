import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Webhook (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // The signature guard verifies against the raw body, as in main.ts.
    app = moduleFixture.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/webhook (POST) accepts a signed ping', () => {
    const body = JSON.stringify({ zen: 'Keep it logically awesome.', hook_id: 1 });
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    return request(app.getHttpServer())
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('x-github-event', 'ping')
      .set('x-hub-signature-256', signature)
      .send(body)
      .expect(202)
      .expect({ ok: true });
  });
});
