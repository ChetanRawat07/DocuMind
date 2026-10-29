import type { Server } from 'node:http';
import { healthResponseSchema } from '@documind/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config/app-config.js';
import { configureHttpApp } from '../src/http/configure-http-app.js';
import { TEST_SUPABASE_URL } from './support/test-auth.js';
import { resolveTestDatabase } from './support/test-database.js';

describe('GET /api/v1/health/ready with a reachable database', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: resolveTestDatabase().url,
      SUPABASE_URL: TEST_SUPABASE_URL,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(config)],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>({ logger: false });
    configureHttpApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports ready', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);

    expect(healthResponseSchema.parse(response.body).status).toBe('ok');
  });
});
