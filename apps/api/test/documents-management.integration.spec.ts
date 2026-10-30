import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  apiErrorResponseSchema,
  documentListResponseSchema,
  documentSchema,
  MAX_DOCUMENT_SEARCH_LENGTH,
} from '@documind/shared';
import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditLogsRepository } from '../src/audit/audit-logs.repository.js';
import { JWT_KEY_RESOLVER } from '../src/auth/access-token-verifier.js';
import { loadConfig } from '../src/config/app-config.js';
import type { DatabaseExecutor } from '../src/database/database.types.js';
import { configureHttpApp } from '../src/http/configure-http-app.js';
import { ObjectStorage } from '../src/storage/object-storage.js';
import { TEST_SUPABASE_URL, TestTokenIssuer } from './support/test-auth.js';
import {
  createTestDatabase,
  resolveTestDatabase,
  truncateAllTables,
} from './support/test-database.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

/** Collects a binary response body into a Buffer (supertest parses only text and JSON by default). */
function binary(response: request.Response, callback: (error: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => {
    callback(null, Buffer.concat(chunks));
  });
}

describe('document search, filters and file access (HTTP)', () => {
  let app: INestApplication<Server>;
  let db: DatabaseExecutor;
  let issuer: TestTokenIssuer;
  let storageRoot: string;
  let alice: string;
  let bob: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function upload(token: string, content: Buffer, filename: string) {
    const response = await http()
      .post('/api/v1/documents')
      .set(bearer(token))
      .attach('file', content, { filename, contentType: 'application/octet-stream' })
      .expect(201);
    return documentSchema.parse(response.body);
  }

  async function listNames(token: string, query: string) {
    const response = await http().get(`/api/v1/documents?${query}`).set(bearer(token)).expect(200);
    const page = documentListResponseSchema.parse(response.body);
    return { names: page.items.map((item) => item.originalFilename), next: page.nextCursor };
  }

  async function auditEntries() {
    const rows = await db
      .selectFrom('audit_logs')
      .select(['action', 'actor_user_id', 'resource_id', 'metadata'])
      .where('action', '!=', 'user.registered')
      .orderBy('id')
      .execute();
    return rows;
  }

  beforeAll(async () => {
    issuer = await TestTokenIssuer.create();
    db = createTestDatabase();
    storageRoot = await mkdtemp(join(tmpdir(), 'documind-management-test-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: resolveTestDatabase().url,
      SUPABASE_URL: TEST_SUPABASE_URL,
      STORAGE_DRIVER: 'filesystem',
      STORAGE_FILESYSTEM_ROOT: storageRoot,
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
    await rm(storageRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    alice = await issuer.sign(randomUUID(), { claims: { email: 'alice@example.test' } });
    bob = await issuer.sign(randomUUID(), { claims: { email: 'bob@example.test' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /documents', () => {
    beforeEach(async () => {
      await upload(alice, PDF, 'Invoice-A.pdf');
      await upload(alice, PNG, 'invoice-scan.png');
      await upload(alice, PDF, 'invoice-c.pdf');
      await upload(alice, PDF, 'contract.pdf');
      await upload(bob, PDF, 'invoice-bob.pdf');
    });

    it('applies search, format filter and sort from the query string', async () => {
      expect(await listNames(alice, 'q=INVOICE&format=pdf&sort=name_desc')).toEqual({
        names: ['invoice-c.pdf', 'Invoice-A.pdf'],
        next: null,
      });
    });

    it('treats a blank search as no filter', async () => {
      expect((await listNames(alice, 'q=%20%20')).names).toHaveLength(4);
    });

    it('filters by status and classification', async () => {
      expect((await listNames(alice, 'status=uploaded&type=unclassified')).names).toHaveLength(4);
      expect((await listNames(alice, 'status=completed')).names).toEqual([]);
      expect((await listNames(alice, 'type=invoice')).names).toEqual([]);
    });

    it('pages a sorted, filtered list with its cursor', async () => {
      const names: string[] = [];
      let page = await listNames(alice, 'limit=1&sort=name_asc&q=invoice');
      names.push(...page.names);
      while (page.next) {
        page = await listNames(
          alice,
          `limit=1&sort=name_asc&q=invoice&cursor=${encodeURIComponent(page.next)}`,
        );
        names.push(...page.names);
      }

      expect(names).toEqual(['Invoice-A.pdf', 'invoice-c.pdf', 'invoice-scan.png']);
    });

    it('rejects a cursor used with a different sort', async () => {
      const { next } = await listNames(alice, 'limit=1&sort=name_asc');

      const response = await http()
        .get(`/api/v1/documents?limit=1&sort=largest&cursor=${encodeURIComponent(next ?? '')}`)
        .set(bearer(alice))
        .expect(400);
      expect(apiErrorResponseSchema.parse(response.body).error.message).toBe(
        'cursor: Invalid cursor',
      );
    });

    it.each([
      ['an unknown sort', 'sort=random'],
      ['an unknown status', 'status=done'],
      ['an unknown type', 'type=receipt'],
      ['an unknown format', 'format=docx'],
      ['a search that is too long', `q=${'a'.repeat(MAX_DOCUMENT_SEARCH_LENGTH + 1)}`],
      ['a repeated filter', 'status=uploaded&status=failed'],
    ])('rejects %s with 400', async (_case, query) => {
      await http().get(`/api/v1/documents?${query}`).set(bearer(alice)).expect(400);
    });
  });

  describe('GET /documents/:id/content', () => {
    it('serves the file inline for previews, with safe headers, and audits the view', async () => {
      const document = await upload(alice, PDF, 'रसीद "march".pdf');

      const response = await http()
        .get(`/api/v1/documents/${document.id}/content?disposition=inline`)
        .set(bearer(alice))
        .buffer(true)
        .parse(binary)
        .expect(200);

      expect(response.body).toEqual(PDF);
      expect(response.headers).toMatchObject({
        'content-type': 'application/pdf',
        'content-length': String(PDF.length),
        'content-disposition': `inline; filename="____ _march_.pdf"; filename*=UTF-8''%E0%A4%B0%E0%A4%B8%E0%A5%80%E0%A4%A6%20%22march%22.pdf`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      const entries = await auditEntries();
      expect(entries.at(-1)).toMatchObject({
        action: 'document.viewed',
        resource_id: document.id,
        // The size and type only: never the filename.
        metadata: { mimeType: 'application/pdf', sizeBytes: PDF.length },
      });
    });

    it('serves a download as an attachment by default and audits it', async () => {
      const document = await upload(alice, PNG, 'scan.png');

      const response = await http()
        .get(`/api/v1/documents/${document.id}/content`)
        .set(bearer(alice))
        .buffer(true)
        .parse(binary)
        .expect(200);

      expect(response.body).toEqual(PNG);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="scan.png"/);
      expect((await auditEntries()).map((entry) => entry.action)).toEqual([
        'document.uploaded',
        'document.downloaded',
      ]);
    });

    it('answers HEAD with the headers only and records no access', async () => {
      const document = await upload(alice, PDF, 'a.pdf');

      const response = await http()
        .head(`/api/v1/documents/${document.id}/content`)
        .set(bearer(alice))
        .expect(200);

      expect(response.headers['content-length']).toBe(String(PDF.length));
      expect((await auditEntries()).map((entry) => entry.action)).toEqual(['document.uploaded']);
    });

    it("returns 404 for another user's document and records no access", async () => {
      const document = await upload(alice, PDF, 'a.pdf');

      const response = await http()
        .get(`/api/v1/documents/${document.id}/content`)
        .set(bearer(bob))
        .expect(404);

      expect(apiErrorResponseSchema.parse(response.body).error.message).toBe('Document not found');
      expect((await auditEntries()).map((entry) => entry.action)).toEqual(['document.uploaded']);
    });

    it('returns 404 for an unknown id and 400 for a malformed one', async () => {
      await http().get(`/api/v1/documents/${randomUUID()}/content`).set(bearer(alice)).expect(404);
      await http().get('/api/v1/documents/not-a-uuid/content').set(bearer(alice)).expect(400);
    });

    it('rejects an unknown disposition', async () => {
      const document = await upload(alice, PDF, 'a.pdf');

      await http()
        .get(`/api/v1/documents/${document.id}/content?disposition=evil`)
        .set(bearer(alice))
        .expect(400);
    });

    it('requires authentication', async () => {
      const document = await upload(alice, PDF, 'a.pdf');

      await http().get(`/api/v1/documents/${document.id}/content`).expect(401);
    });

    it('answers 500 and logs it when the stored file is missing, recording no access', async () => {
      const document = await upload(alice, PDF, 'a.pdf');
      await rm(storageRoot, { recursive: true, force: true });
      const logError = vi.spyOn(Logger.prototype, 'error');

      const response = await http()
        .get(`/api/v1/documents/${document.id}/content`)
        .set(bearer(alice))
        .expect(500);

      expect(apiErrorResponseSchema.parse(response.body).error.message).toBe(
        'An unexpected error occurred.',
      );
      expect(logError).toHaveBeenCalledWith(
        expect.stringMatching(`^Document ${document.id} has no stored object at documents/`),
      );
      expect((await auditEntries()).map((entry) => entry.action)).toEqual(['document.uploaded']);
    });

    it('does not serve the file when the access cannot be audited', async () => {
      const document = await upload(alice, PDF, 'a.pdf');
      vi.spyOn(app.get(AuditLogsRepository), 'append').mockRejectedValueOnce(
        new Error('connection lost'),
      );

      const response = await http()
        .get(`/api/v1/documents/${document.id}/content`)
        .set(bearer(alice))
        .expect(500);

      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['content-disposition']).toBeUndefined();
    });

    it('answers a storage read that fails before the first byte with the standard 500', async () => {
      const document = await upload(alice, PDF, 'a.pdf');
      const failing = new Readable({
        read() {
          this.destroy(new Error('EIO: read failed'));
        },
      });
      vi.spyOn(app.get(ObjectStorage), 'get').mockResolvedValueOnce({ body: failing, size: 100 });

      const response = await http()
        .get(`/api/v1/documents/${document.id}/content`)
        .set(bearer(alice))
        .expect(500);

      expect(apiErrorResponseSchema.parse(response.body).error).toEqual({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
      });
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['content-disposition']).toBeUndefined();
    });

    it('cuts the connection when the storage read fails mid-file', async () => {
      const document = await upload(alice, PDF, 'a.pdf');
      let sent = false;
      const failing = new Readable({
        read() {
          if (sent) {
            this.destroy(new Error('connection reset by storage'));
          } else {
            sent = true;
            this.push(Buffer.alloc(1024, 'a'));
          }
        },
      });
      vi.spyOn(app.get(ObjectStorage), 'get').mockResolvedValueOnce({ body: failing, size: 4096 });

      await expect(
        http()
          .get(`/api/v1/documents/${document.id}/content`)
          .set(bearer(alice))
          .buffer(true)
          .parse(binary),
      ).rejects.toThrow();
    });
  });
});
