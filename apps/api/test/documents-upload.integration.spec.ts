import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  apiErrorResponseSchema,
  documentListResponseSchema,
  documentSchema,
  MAX_UPLOAD_BYTES,
  processingJobListResponseSchema,
  processingJobSchema,
} from '@documind/shared';
import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { JWT_KEY_RESOLVER } from '../src/auth/access-token-verifier.js';
import { loadConfig } from '../src/config/app-config.js';
import type { DatabaseExecutor } from '../src/database/database.types.js';
import { DocumentsRepository } from '../src/documents/documents.repository.js';
import { configureHttpApp } from '../src/http/configure-http-app.js';
import { ObjectStorage } from '../src/storage/object-storage.js';
import { STORAGE_KEY_PATTERN } from '../src/storage/storage-key.js';
import { TEST_SUPABASE_URL, TestTokenIssuer } from './support/test-auth.js';
import {
  createTestDatabase,
  resolveTestDatabase,
  truncateAllTables,
} from './support/test-database.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00', 'latin1');

describe('document upload and deletion (HTTP)', () => {
  let app: INestApplication<Server>;
  let db: DatabaseExecutor;
  let issuer: TestTokenIssuer;
  let storageRoot: string;
  let alice: string;
  let bob: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  function upload(
    token: string,
    content: Buffer,
    filename: string,
    contentType = 'application/octet-stream',
  ) {
    return http().post('/api/v1/documents').set(bearer(token)).attach('file', content, {
      filename,
      contentType,
    });
  }

  /** Every file under the storage root, as paths relative to it. */
  async function storedFiles(): Promise<string[]> {
    const entries = await readdir(storageRoot, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(storageRoot.length + 1));
  }

  async function documentCount(): Promise<number> {
    const row = await db
      .selectFrom('documents')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async function auditActions(): Promise<string[]> {
    const rows = await db.selectFrom('audit_logs').select('action').orderBy('id').execute();
    return rows.map((row) => row.action).filter((action) => action !== 'user.registered');
  }

  async function expectNothingStored() {
    expect(await documentCount()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  }

  beforeAll(async () => {
    issuer = await TestTokenIssuer.create();
    db = createTestDatabase();
    storageRoot = await mkdtemp(join(tmpdir(), 'documind-upload-test-'));
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
    await rm(storageRoot, { recursive: true, force: true });
    await mkdir(storageRoot);
    alice = await issuer.sign(randomUUID(), { claims: { email: 'alice@example.test' } });
    bob = await issuer.sign(randomUUID(), { claims: { email: 'bob@example.test' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('upload', () => {
    it('stores the file privately and queues the document for processing', async () => {
      const response = await upload(alice, PDF, 'invoice-1023.pdf').expect(201);

      const document = documentSchema.parse(response.body);
      expect(document).toMatchObject({
        originalFilename: 'invoice-1023.pdf',
        mimeType: 'application/pdf',
        sizeBytes: PDF.length,
        documentType: null,
        status: 'queued',
        processedAt: null,
      });
      expect(response.body).not.toHaveProperty('storageKey');
      const jobs = await db
        .selectFrom('processing_jobs')
        .select(['document_id', 'status'])
        .execute();
      expect(jobs).toEqual([{ document_id: document.id, status: 'queued' }]);

      const row = await db
        .selectFrom('documents')
        .selectAll()
        .where('id', '=', document.id)
        .executeTakeFirstOrThrow();
      expect(row.storage_key).toMatch(STORAGE_KEY_PATTERN);
      expect(row.storage_key).toBe(
        `documents/${row.user_id}/${new Date().getUTCFullYear()}/${document.id}/original.pdf`,
      );
      expect(await readFile(join(storageRoot, row.storage_key))).toEqual(PDF);
    });

    it('records an audit entry without the filename', async () => {
      const document = documentSchema.parse((await upload(alice, PDF, 'secret-deal.pdf')).body);

      const entry = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('action', '=', 'document.uploaded')
        .executeTakeFirstOrThrow();
      expect(entry).toMatchObject({
        actor_type: 'user',
        resource_type: 'document',
        resource_id: document.id,
        metadata: { mimeType: 'application/pdf', sizeBytes: PDF.length },
      });
      expect(JSON.stringify(entry.metadata)).not.toContain('secret-deal');
    });

    it('stores the type found in the content, not the type the client claims', async () => {
      const response = await upload(alice, PNG, 'scan.png', 'text/html').expect(201);

      expect(documentSchema.parse(response.body).mimeType).toBe('image/png');
    });

    it('keeps a UTF-8 filename intact', async () => {
      const response = await upload(alice, PDF, 'रसीद-ünïcödé.pdf').expect(201);

      expect(documentSchema.parse(response.body).originalFilename).toBe('रसीद-ünïcödé.pdf');
    });

    it('never lets the filename influence where the file is stored', async () => {
      const response = await upload(alice, PDF, '../../../../etc/cron.d/evil.pdf').expect(201);

      expect(documentSchema.parse(response.body).originalFilename).toBe('evil.pdf');
      const [file] = await storedFiles();
      expect(file).toMatch(STORAGE_KEY_PATTERN);
    });

    it('lists the uploaded document for its owner only', async () => {
      const document = documentSchema.parse((await upload(alice, PDF, 'a.pdf')).body);

      const mine = await http().get('/api/v1/documents').set(bearer(alice)).expect(200);
      const theirs = await http().get('/api/v1/documents').set(bearer(bob)).expect(200);

      expect(documentListResponseSchema.parse(mine.body).items.map((item) => item.id)).toEqual([
        document.id,
      ]);
      expect(documentListResponseSchema.parse(theirs.body).items).toEqual([]);
    });

    it.each([
      ['an executable renamed to .pdf', EXE, 'invoice.pdf', 415, 'not a valid PDF file'],
      ['a PNG named .pdf', PNG, 'invoice.pdf', 415, 'not a valid PDF file'],
      ['a disallowed extension', EXE, 'setup.exe', 415, 'Unsupported file type'],
      ['HTML named .html', Buffer.from('<script>alert(1)</script>'), 'x.html', 415, 'Unsupported'],
      ['an empty file', Buffer.alloc(0), 'empty.pdf', 400, 'The file is empty.'],
    ])('rejects %s and stores nothing', async (_case, content, filename, status, message) => {
      const response = await upload(alice, content, filename).expect(status);

      expect(apiErrorResponseSchema.parse(response.body).error.message).toContain(message);
      await expectNothingStored();
    });

    it('rejects a file over 10 MB with 413 and stores nothing', async () => {
      const content = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
      PDF.copy(content);

      const response = await upload(alice, content, 'huge.pdf').expect(413);

      // Multer's message: the parser stopped reading at the limit instead of
      // buffering the whole body (validateUpload's size check is a backstop).
      expect(apiErrorResponseSchema.parse(response.body).error.message).toBe('File too large');
      await expectNothingStored();
    });

    it('accepts a file of exactly 10 MB', async () => {
      const content = Buffer.alloc(MAX_UPLOAD_BYTES);
      PDF.copy(content);

      await upload(alice, content, 'max.pdf').expect(201);
    });

    it('requires a file', async () => {
      const response = await http()
        .post('/api/v1/documents')
        .set(bearer(alice))
        .send({ file: 'not a file' })
        .expect(400);

      expect(apiErrorResponseSchema.parse(response.body).error.message).toBe(
        'file: A file is required',
      );
    });

    it.each([
      ['a different field name', (r: request.Test) => r.attach('document', PDF, 'a.pdf')],
      [
        'two files',
        (r: request.Test) => r.attach('file', PDF, 'a.pdf').attach('file', PDF, 'b.pdf'),
      ],
      [
        'an extra text field',
        (r: request.Test) => r.field('ownerId', randomUUID()).attach('file', PDF, 'a.pdf'),
      ],
    ])('rejects a multipart body with %s', async (_case, build) => {
      await build(http().post('/api/v1/documents').set(bearer(alice))).expect(400);

      await expectNothingStored();
    });

    it('rejects an unauthenticated upload before storing anything', async () => {
      await http().post('/api/v1/documents').attach('file', PDF, 'a.pdf').expect(401);

      await expectNothingStored();
    });

    it('removes the stored file when the database write fails', async () => {
      vi.spyOn(app.get(DocumentsRepository), 'create').mockRejectedValueOnce(
        new Error('connection lost'),
      );

      const response = await upload(alice, PDF, 'a.pdf').expect(500);

      expect(apiErrorResponseSchema.parse(response.body).error.message).toBe(
        'An unexpected error occurred.',
      );
      await expectNothingStored();
      expect(await auditActions()).toEqual([]);
    });

    it('creates no document when storage fails', async () => {
      vi.spyOn(app.get(ObjectStorage), 'put').mockRejectedValueOnce(new Error('bucket offline'));

      await upload(alice, PDF, 'a.pdf').expect(500);

      expect(await documentCount()).toBe(0);
    });
  });

  describe('delete', () => {
    async function uploaded(token: string) {
      const document = documentSchema.parse((await upload(token, PDF, 'a.pdf').expect(201)).body);
      const row = await db
        .selectFrom('documents')
        .select('storage_key')
        .where('id', '=', document.id)
        .executeTakeFirstOrThrow();
      return { id: document.id, storageKey: row.storage_key };
    }

    it('deletes the document, its file and records an audit entry', async () => {
      const { id } = await uploaded(alice);

      await http().delete(`/api/v1/documents/${id}`).set(bearer(alice)).expect(204);

      await expectNothingStored();
      await http().get(`/api/v1/documents/${id}`).set(bearer(alice)).expect(404);
      expect(await auditActions()).toEqual(['document.uploaded', 'document.deleted']);
    });

    it("returns 404 for another user's document and leaves it untouched", async () => {
      const { id, storageKey } = await uploaded(alice);

      const response = await http().delete(`/api/v1/documents/${id}`).set(bearer(bob)).expect(404);

      expect(apiErrorResponseSchema.parse(response.body).error.message).toBe('Document not found');
      expect(await documentCount()).toBe(1);
      expect(await storedFiles()).toEqual([storageKey]);
    });

    it('returns 404 when deleting twice or an unknown id', async () => {
      const { id } = await uploaded(alice);
      await http().delete(`/api/v1/documents/${id}`).set(bearer(alice)).expect(204);

      await http().delete(`/api/v1/documents/${id}`).set(bearer(alice)).expect(404);
      await http().delete(`/api/v1/documents/${randomUUID()}`).set(bearer(alice)).expect(404);
    });

    it('rejects a malformed id with 400', async () => {
      await http().delete('/api/v1/documents/not-a-uuid').set(bearer(alice)).expect(400);
    });

    it('still deletes the document when the file cannot be removed (orphan is logged)', async () => {
      const { id, storageKey } = await uploaded(alice);
      vi.spyOn(app.get(ObjectStorage), 'delete').mockRejectedValueOnce(new Error('timeout'));
      const logError = vi.spyOn(Logger.prototype, 'error');

      await http().delete(`/api/v1/documents/${id}`).set(bearer(alice)).expect(204);

      expect(await documentCount()).toBe(0);
      expect(logError).toHaveBeenCalledWith(
        `Orphaned object ${storageKey}: could not remove it after deleting its document: timeout`,
      );
    });

    it('requires authentication', async () => {
      const { id } = await uploaded(alice);

      await http().delete(`/api/v1/documents/${id}`).expect(401);

      expect(await documentCount()).toBe(1);
    });
  });

  describe('processing jobs', () => {
    async function uploadedId(token: string): Promise<string> {
      return documentSchema.parse((await upload(token, PDF, 'a.pdf').expect(201)).body).id;
    }

    /** What the worker leaves behind when it gives up on a document. */
    async function failProcessing(documentId: string): Promise<void> {
      await db
        .updateTable('processing_jobs')
        .set({
          status: 'failed',
          attempts: 3,
          finished_at: new Date(),
          last_error_code: 'ocr_failed',
        })
        .where('document_id', '=', documentId)
        .execute();
      await db
        .updateTable('documents')
        .set({ status: 'failed', processed_at: new Date() })
        .where('id', '=', documentId)
        .execute();
    }

    it("lists a document's jobs with their error codes, newest first", async () => {
      const id = await uploadedId(alice);
      await failProcessing(id);
      await http().post(`/api/v1/documents/${id}/jobs`).set(bearer(alice)).expect(202);

      const response = await http()
        .get(`/api/v1/documents/${id}/jobs`)
        .set(bearer(alice))
        .expect(200);

      const { items } = processingJobListResponseSchema.parse(response.body);
      expect(items.map((job) => [job.status, job.errorCode])).toEqual([
        ['queued', null],
        ['failed', 'ocr_failed'],
      ]);
      expect(JSON.stringify(response.body)).not.toContain('lastErrorMessage');
    });

    it('retries a failed document with a new job', async () => {
      const id = await uploadedId(alice);
      await failProcessing(id);

      const response = await http()
        .post(`/api/v1/documents/${id}/jobs`)
        .set(bearer(alice))
        .expect(202);

      expect(processingJobSchema.parse(response.body)).toMatchObject({
        status: 'queued',
        attempts: 0,
      });
      const document = documentSchema.parse(
        (await http().get(`/api/v1/documents/${id}`).set(bearer(alice)).expect(200)).body,
      );
      expect(document).toMatchObject({ status: 'queued', processedAt: null });
      expect(await auditActions()).toEqual(['document.uploaded', 'document.processing_requested']);
    });

    it('queues a document stored before processing existed', async () => {
      const id = await uploadedId(alice);
      await db.deleteFrom('processing_jobs').where('document_id', '=', id).execute();
      await db.updateTable('documents').set({ status: 'uploaded' }).where('id', '=', id).execute();

      await http().post(`/api/v1/documents/${id}/jobs`).set(bearer(alice)).expect(202);

      expect((await db.selectFrom('processing_jobs').select('id').execute()).length).toBe(1);
    });

    it('returns the active job instead of queueing twice', async () => {
      const id = await uploadedId(alice);
      await failProcessing(id);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          http().post(`/api/v1/documents/${id}/jobs`).set(bearer(alice)).expect(202),
        ),
      );

      expect(
        new Set(responses.map((response) => processingJobSchema.parse(response.body).id)).size,
      ).toBe(1);
      expect(await auditActions()).toEqual(['document.uploaded', 'document.processing_requested']);
    });

    it('refuses to reprocess a document that reached review', async () => {
      const id = await uploadedId(alice);
      await failProcessing(id);
      await db
        .updateTable('documents')
        .set({ status: 'needs_review' })
        .where('id', '=', id)
        .execute();

      const response = await http()
        .post(`/api/v1/documents/${id}/jobs`)
        .set(bearer(alice))
        .expect(409);

      expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('CONFLICT');
    });

    it("returns 404 for another user's document on both routes", async () => {
      const id = await uploadedId(alice);
      await failProcessing(id);

      await http().get(`/api/v1/documents/${id}/jobs`).set(bearer(bob)).expect(404);
      await http().post(`/api/v1/documents/${id}/jobs`).set(bearer(bob)).expect(404);
      await http().post(`/api/v1/documents/${randomUUID()}/jobs`).set(bearer(alice)).expect(404);

      expect((await db.selectFrom('processing_jobs').select('id').execute()).length).toBe(1);
    });

    it('requires authentication', async () => {
      const id = await uploadedId(alice);

      await http().get(`/api/v1/documents/${id}/jobs`).expect(401);
      await http().post(`/api/v1/documents/${id}/jobs`).expect(401);
    });
  });
});
