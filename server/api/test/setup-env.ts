// AppModule reads its role and dotenv when it loads, so these must be set
// before any test file imports it. The gateway role keeps the worker, and with
// it Docker, out of the e2e run.
process.env.APP_ROLE = 'gateway';
process.env.GITHUB_WEBHOOK_SECRET = 'e2e-secret';
process.env.DATABASE_URL ??= 'postgresql://admin:password@localhost:5432/synclab';
