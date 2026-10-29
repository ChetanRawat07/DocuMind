import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertDocument, insertUser } from '../../test/support/factories.js';
import { expectPgError, PG } from '../../test/support/postgres-errors.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository.js';
import { DocumentsRepository, type NewDocument } from './documents.repository.js';

describe('DocumentsRepository', () => {
  let db: DatabaseExecutor;
  let documents: DocumentsRepository;
  let ownerId: string;
  let otherOwnerId: string;

  const newDocument = (owner: string, overrides: Partial<NewDocument> = {}): NewDocument => {
    const id = overrides.id ?? randomUUID();
    return {
      id,
      ownerId: owner,
      originalFilename: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      storageKey: `documents/${owner}/2026/${id}/original.pdf`,
      ...overrides,
    };
  };

  beforeAll(() => {
    db = createTestDatabase();
    documents = new DocumentsRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    ownerId = (await insertUser(db)).id;
    otherOwnerId = (await insertUser(db)).id;
  });

  describe('create', () => {
    it('stores a new document as uploaded and unclassified', async () => {
      const input = newDocument(ownerId);

      const created = await documents.create(input);

      expect(created).toMatchObject({
        id: input.id,
        ownerId,
        originalFilename: 'invoice.pdf',
        sizeBytes: 2048,
        status: 'uploaded',
        documentType: null,
        processedAt: null,
      });
      expect(created.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('findByIdForOwner', () => {
    it("returns the owner's document", async () => {
      const { id } = await documents.create(newDocument(ownerId));

      expect(await documents.findByIdForOwner(ownerId, id)).toMatchObject({ id, ownerId });
    });

    it("does not reveal another user's document (IDOR)", async () => {
      const { id } = await documents.create(newDocument(ownerId));

      expect(await documents.findByIdForOwner(otherOwnerId, id)).toBeNull();
    });

    it('returns null for an unknown id', async () => {
      expect(await documents.findByIdForOwner(ownerId, randomUUID())).toBeNull();
    });

    it('rejects an id that is not a UUID instead of matching anything', async () => {
      await expectPgError(documents.findByIdForOwner(ownerId, "1' OR '1'='1"), {
        code: PG.invalidTextRepresentation,
      });
    });
  });

  describe('listForOwner', () => {
    it('pages through all documents newest first without gaps or duplicates', async () => {
      // Five documents share one timestamp, so only the id tiebreaker orders them.
      const sameInstant = new Date('2026-10-01T12:00:00.123Z');
      const inserted = await Promise.all(
        Array.from({ length: 5 }, () => insertDocument(db, ownerId, { createdAt: sameInstant })),
      );
      inserted.push(
        await insertDocument(db, ownerId, { createdAt: new Date('2026-10-02T00:00:00.000Z') }),
      );
      await insertDocument(db, otherOwnerId);

      const seen: string[] = [];
      let page = await documents.listForOwner(ownerId, { limit: 2 });
      seen.push(...page.items.map((document) => document.id));
      while (page.nextCursor) {
        page = await documents.listForOwner(ownerId, { limit: 2, after: page.nextCursor });
        seen.push(...page.items.map((document) => document.id));
      }

      expect(seen).toHaveLength(6);
      expect(new Set(seen)).toEqual(new Set(inserted.map((document) => document.id)));
      expect(seen[0]).toBe(inserted[5]?.id);
    });

    it('returns no cursor when the page is the last one', async () => {
      await insertDocument(db, ownerId);

      const page = await documents.listForOwner(ownerId, { limit: 1 });

      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    });

    it.each([0, 101, 1.5])('rejects limit %s to keep queries bounded', async (limit) => {
      await expect(documents.listForOwner(ownerId, { limit })).rejects.toThrow(RangeError);
    });
  });

  describe('deleteForOwner', () => {
    it('deletes the document and returns it so its stored object can be removed', async () => {
      const created = await documents.create(newDocument(ownerId));

      const deleted = await documents.deleteForOwner(ownerId, created.id);

      expect(deleted?.storageKey).toBe(created.storageKey);
      expect(await documents.findByIdForOwner(ownerId, created.id)).toBeNull();
    });

    it("cannot delete another user's document", async () => {
      const created = await documents.create(newDocument(ownerId));

      expect(await documents.deleteForOwner(otherOwnerId, created.id)).toBeNull();
      expect(await documents.findByIdForOwner(ownerId, created.id)).not.toBeNull();
    });
  });

  describe('transactions', () => {
    it('rolls back every write in the transaction when a later step fails', async () => {
      const input = newDocument(ownerId);
      const jobs = new ProcessingJobsRepository(db);

      await expect(
        db.transaction().execute(async (trx) => {
          await documents.create(input, trx);
          await jobs.enqueue(input.id, trx);
          throw new Error('storage upload failed');
        }),
      ).rejects.toThrow('storage upload failed');

      expect(await documents.findByIdForOwner(ownerId, input.id)).toBeNull();
      expect(await jobs.findActiveForDocument(input.id)).toBeNull();
    });
  });
});
