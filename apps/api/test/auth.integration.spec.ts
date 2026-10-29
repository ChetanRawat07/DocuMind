import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  apiErrorResponseSchema,
  currentUserSchema,
  documentListResponseSchema,
  documentSchema,
} from '@documind/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { JWT_KEY_RESOLVER } from '../src/auth/access-token-verifier.js';
import { loadConfig } from '../src/config/app-config.js';
import type { DatabaseExecutor } from '../src/database/database.types.js';
import { configureHttpApp } from '../src/http/configure-http-app.js';
import { insertDocument, insertUser } from './support/factories.js';
import { generateForeignKey, TEST_SUPABASE_URL, TestTokenIssuer } from './support/test-auth.js';
import {
  createTestDatabase,
  resolveTestDatabase,
  truncateAllTables,
} from './support/test-database.js';

describe('authentication and authorization (HTTP)', () => {
  let app: INestApplication<Server>;
  let db: DatabaseExecutor;
  let issuer: TestTokenIssuer;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function countRows(table: 'users' | 'audit_logs'): Promise<number> {
    const row = await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  beforeAll(async () => {
    issuer = await TestTokenIssuer.create();
    db = createTestDatabase();
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: resolveTestDatabase().url,
      SUPABASE_URL: TEST_SUPABASE_URL,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(config)],
    })
      .overrideProvider(JWT_KEY_RESOLVER)
      .useValue(issuer.keyResolver)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>({ logger: false });
    configureHttpApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  describe('authentication', () => {
    it('keeps health probes public', async () => {
      await http().get('/api/v1/health').expect(200);
      await http().get('/api/v1/health/ready').expect(200);
    });

    it('rejects a request without credentials', async () => {
      const response = await http().get('/api/v1/me').expect(401);

      expect(apiErrorResponseSchema.parse(response.body).error).toEqual({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      expect(response.headers['www-authenticate']).toBe('Bearer realm="documind"');
    });

    it.each([
      ['another scheme', 'Basic dXNlcjpwYXNz'],
      ['an empty bearer token', 'Bearer '],
      ['a token with spaces', 'Bearer a b'],
    ])('rejects an Authorization header with %s', async (_case, header) => {
      await http().get('/api/v1/me').set('Authorization', header).expect(401);
    });

    it('rejects an invalid token and says so in WWW-Authenticate', async () => {
      const response = await http().get('/api/v1/me').set(bearer('not.a.jwt')).expect(401);

      expect(apiErrorResponseSchema.parse(response.body).error.message).toBe(
        'Invalid access token',
      );
      expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
    });

    it('rejects a token signed by an unknown key', async () => {
      const token = await issuer.sign(randomUUID(), { key: await generateForeignKey() });

      await http().get('/api/v1/me').set(bearer(token)).expect(401);
    });

    it('tells the client an expired token is expired, so it can refresh', async () => {
      const token = await issuer.sign(randomUUID(), { expiresIn: -60 });

      const response = await http().get('/api/v1/me').set(bearer(token)).expect(401);

      expect(apiErrorResponseSchema.parse(response.body).error.message).toBe(
        'Access token expired',
      );
    });

    it('accepts the bearer scheme case-insensitively', async () => {
      const token = await issuer.sign(randomUUID());

      await http().get('/api/v1/me').set('Authorization', `bearer ${token}`).expect(200);
    });

    it('never lets responses be cached', async () => {
      const response = await http()
        .get('/api/v1/me')
        .set(bearer(await issuer.sign(randomUUID())));

      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('user provisioning', () => {
    it('creates the user and an audit entry on first request', async () => {
      const id = randomUUID();
      const token = await issuer.sign(id, {
        claims: { email: 'ada@example.test', user_metadata: { display_name: 'Ada' } },
      });

      const response = await http().get('/api/v1/me').set(bearer(token)).expect(200);

      expect(currentUserSchema.parse(response.body)).toMatchObject({
        id,
        email: 'ada@example.test',
        displayName: 'Ada',
      });
      const audit = await db.selectFrom('audit_logs').selectAll().execute();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'user.registered',
        actor_type: 'user',
        actor_user_id: id,
        resource_type: 'user',
        resource_id: id,
      });
    });

    it('does not write on later requests when nothing changed', async () => {
      const token = await issuer.sign(randomUUID());
      await http().get('/api/v1/me').set(bearer(token)).expect(200);
      const before = await db.selectFrom('users').select('updated_at').executeTakeFirstOrThrow();

      await http().get('/api/v1/me').set(bearer(token)).expect(200);

      const after = await db.selectFrom('users').select('updated_at').executeTakeFirstOrThrow();
      expect(after.updated_at).toEqual(before.updated_at);
      expect(await countRows('audit_logs')).toBe(1);
    });

    it('syncs a changed email from the identity provider', async () => {
      const id = randomUUID();
      await http()
        .get('/api/v1/me')
        .set(bearer(await issuer.sign(id, { claims: { email: 'old@example.test' } })))
        .expect(200);

      const response = await http()
        .get('/api/v1/me')
        .set(bearer(await issuer.sign(id, { claims: { email: 'new@example.test' } })))
        .expect(200);

      expect(currentUserSchema.parse(response.body).email).toBe('new@example.test');
      expect(await countRows('users')).toBe(1);
    });

    it('creates exactly one user under concurrent first requests', async () => {
      const token = await issuer.sign(randomUUID());

      const responses = await Promise.all(
        Array.from({ length: 8 }, () => http().get('/api/v1/me').set(bearer(token))),
      );

      expect(responses.map((response) => response.status)).toEqual(Array(8).fill(200));
      expect(await countRows('users')).toBe(1);
      expect(await countRows('audit_logs')).toBe(1);
    });

    it('accepts a new user whose email a stale row still holds', async () => {
      await insertUser(db, { email: 'shared@example.test' });
      const token = await issuer.sign(randomUUID(), { claims: { email: 'shared@example.test' } });

      await http().get('/api/v1/me').set(bearer(token)).expect(200);
    });
  });

  describe('document ownership', () => {
    let alice: { id: string; token: string };
    let bob: { id: string; token: string };

    beforeEach(async () => {
      for (const name of ['alice', 'bob'] as const) {
        const { id } = await insertUser(db);
        const user = { id, token: await issuer.sign(id) };
        if (name === 'alice') alice = user;
        else bob = user;
      }
    });

    it('rejects unauthenticated document requests', async () => {
      const { id } = await insertDocument(db, alice.id);

      await http().get('/api/v1/documents').expect(401);
      await http().get(`/api/v1/documents/${id}`).expect(401);
    });

    it('returns the owner their document without internal fields', async () => {
      const { id } = await insertDocument(db, alice.id);

      const response = await http()
        .get(`/api/v1/documents/${id}`)
        .set(bearer(alice.token))
        .expect(200);

      expect(documentSchema.parse(response.body).id).toBe(id);
      expect(response.body).not.toHaveProperty('storageKey');
      expect(response.body).not.toHaveProperty('ownerId');
    });

    it("answers another user's document exactly like a nonexistent one (IDOR)", async () => {
      const { id } = await insertDocument(db, alice.id);

      const foreign = await http()
        .get(`/api/v1/documents/${id}`)
        .set(bearer(bob.token))
        .expect(404);
      const missing = await http()
        .get(`/api/v1/documents/${randomUUID()}`)
        .set(bearer(bob.token))
        .expect(404);

      expect(foreign.body).toEqual(missing.body);
    });

    it('lists only the caller’s documents', async () => {
      await insertDocument(db, alice.id);
      await insertDocument(db, alice.id);
      const bobs = await insertDocument(db, bob.id);

      const response = await http().get('/api/v1/documents').set(bearer(bob.token)).expect(200);

      const body = documentListResponseSchema.parse(response.body);
      expect(body.items.map((item) => item.id)).toEqual([bobs.id]);
      expect(body.nextCursor).toBeNull();
    });

    it('pages through all documents with the opaque cursor', async () => {
      const base = Date.parse('2026-10-01T00:00:00.000Z');
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        // Two pairs share a timestamp to exercise the id tiebreaker.
        const createdAt = new Date(base + Math.floor(index / 2) * 1000);
        ids.push((await insertDocument(db, alice.id, { createdAt })).id);
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const response = await http()
          .get('/api/v1/documents')
          .query({ limit: 2, ...(cursor ? { cursor } : {}) })
          .set(bearer(alice.token))
          .expect(200);
        const page = documentListResponseSchema.parse(response.body);
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor);

      expect(seen).toHaveLength(5);
      expect(new Set(seen)).toEqual(new Set(ids));
    });

    it("cannot reach another user's documents with a crafted cursor", async () => {
      await insertDocument(db, alice.id);
      const cursor = Buffer.from(
        JSON.stringify({ createdAt: '2999-01-01T00:00:00.000Z', id: randomUUID() }),
      ).toString('base64url');

      const response = await http()
        .get('/api/v1/documents')
        .query({ cursor })
        .set(bearer(bob.token))
        .expect(200);

      expect(documentListResponseSchema.parse(response.body).items).toEqual([]);
    });

    it('rejects a malformed document id with 400 instead of a database error', async () => {
      const response = await http()
        .get('/api/v1/documents/not-a-uuid')
        .set(bearer(alice.token))
        .expect(400);

      expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('BAD_REQUEST');
    });

    it.each([
      ['limit', '0'],
      ['limit', '101'],
      ['limit', 'abc'],
      ['cursor', 'not-a-cursor'],
      ['cursor', Buffer.from('{"createdAt":"yesterday","id":"x"}').toString('base64url')],
    ])('rejects %s=%s with 400', async (name, value) => {
      await http()
        .get('/api/v1/documents')
        .query({ [name]: value })
        .set(bearer(alice.token))
        .expect(400);
    });
  });
});
