import { Controller, Get, type INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { apiErrorResponseSchema, healthResponseSchema } from '@documind/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config/app-config.js';
import { configureHttpApp } from '../src/http/configure-http-app.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const INTERNAL_DETAIL = 'db password=hunter2 at 10.0.0.5';

/** Test-only route that fails the way an unexpected bug would. */
@Controller('test-failure')
class FailingController {
  @Get()
  fail(): never {
    throw new Error(INTERNAL_DETAIL);
  }
}

describe('HTTP application', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const config = loadConfig({ NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(config)],
      controllers: [FailingController],
    }).compile();

    app = moduleRef.createNestApplication<INestApplication<Server>>({ logger: false });
    configureHttpApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health', () => {
    it('returns a liveness response matching the shared contract', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(healthResponseSchema.parse(response.body).status).toBe('ok');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('sends baseline security headers and hides the framework', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('error format', () => {
    it.each(['/api/v1/does-not-exist', '/does-not-exist', '/health', '/'])(
      'answers unknown path %s with a 404 in the standard envelope',
      async (path) => {
        const response = await request(app.getHttpServer()).get(path).expect(404);

        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('NOT_FOUND');
      },
    );

    it('rejects malformed JSON with a 400 in the standard envelope', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/health')
        .set('Content-Type', 'application/json')
        .send('{"broken":')
        .expect(400);

      expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('BAD_REQUEST');
    });

    it('rejects an oversized JSON body with a 413, not a server error', async () => {
      const oversizedBody = JSON.stringify({ padding: 'a'.repeat(200 * 1024) });

      const response = await request(app.getHttpServer())
        .post('/api/v1/health')
        .set('Content-Type', 'application/json')
        .send(oversizedBody)
        .expect(413);

      expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('hides internal details of unexpected errors', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/test-failure').expect(500);

      const body = apiErrorResponseSchema.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(JSON.stringify(response.body)).not.toContain(INTERNAL_DETAIL);
    });
  });

  describe('CORS', () => {
    it('allows a configured origin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', ALLOWED_ORIGIN);

      expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    });

    it('does not grant access to an unknown origin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'https://attacker.example');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
