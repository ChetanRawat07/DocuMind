import { randomUUID } from 'node:crypto';
import { DOCUMENT_SORTS, type DocumentSort } from '@documind/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertDocument, insertUser } from '../../test/support/factories.js';
import { expectPgError, PG } from '../../test/support/postgres-errors.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository.js';
import {
  type DocumentListFilters,
  DocumentsRepository,
  escapeLikePattern,
  type NewDocument,
} from './documents.repository.js';

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
      let page = await documents.listForOwner(ownerId, { limit: 2, sort: 'newest' });
      seen.push(...page.items.map((document) => document.id));
      while (page.nextCursor) {
        page = await documents.listForOwner(ownerId, {
          limit: 2,
          sort: 'newest',
          after: page.nextCursor,
        });
        seen.push(...page.items.map((document) => document.id));
      }

      expect(seen).toHaveLength(6);
      expect(new Set(seen)).toEqual(new Set(inserted.map((document) => document.id)));
      expect(seen[0]).toBe(inserted[5]?.id);
    });

    it('returns no cursor when the page is the last one', async () => {
      await insertDocument(db, ownerId);

      const page = await documents.listForOwner(ownerId, { limit: 1, sort: 'newest' });

      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    });

    describe('sorting', () => {
      // Expected name order under the ICU root collation, independent of the database default.
      const NAME_ORDER = ['alpha.pdf', 'beta.pdf', 'Éclair.pdf', 'same.pdf', 'Zeta.pdf'];
      const SAME_INSTANT = new Date('2026-10-04T00:00:00.000Z');
      const ROWS = [
        {
          originalFilename: 'Zeta.pdf',
          sizeBytes: 3000,
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
        },
        {
          originalFilename: 'alpha.pdf',
          sizeBytes: 1000,
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
        },
        {
          originalFilename: 'Éclair.pdf',
          sizeBytes: 2000,
          createdAt: new Date('2026-10-03T00:00:00.000Z'),
        },
        // Equal name, size and time: only the id tiebreaker orders these two.
        { originalFilename: 'same.pdf', sizeBytes: 2000, createdAt: SAME_INSTANT },
        { originalFilename: 'same.pdf', sizeBytes: 2000, createdAt: SAME_INSTANT },
        {
          originalFilename: 'beta.pdf',
          sizeBytes: 500,
          createdAt: new Date('2026-10-05T00:00:00.000Z'),
        },
      ];
      type Row = (typeof ROWS)[number] & { id: string };

      const KEYS: Record<DocumentSort, { key: (row: Row) => number; descending: boolean }> = {
        newest: { key: (row) => row.createdAt.getTime(), descending: true },
        oldest: { key: (row) => row.createdAt.getTime(), descending: false },
        name_asc: { key: (row) => NAME_ORDER.indexOf(row.originalFilename), descending: false },
        name_desc: { key: (row) => NAME_ORDER.indexOf(row.originalFilename), descending: true },
        largest: { key: (row) => row.sizeBytes, descending: true },
        smallest: { key: (row) => row.sizeBytes, descending: false },
      };

      /** Sort key, then id (PostgreSQL orders uuids like their lowercase hex text). */
      function expectedIds(rows: readonly Row[], sort: DocumentSort): string[] {
        const { key, descending } = KEYS[sort];
        const sign = descending ? -1 : 1;
        return [...rows]
          .sort((a, b) => sign * (key(a) - key(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
          .map((row) => row.id);
      }

      it.each(DOCUMENT_SORTS)(
        'pages through every document in %s order without gaps or duplicates',
        async (sort) => {
          const rows: Row[] = [];
          for (const row of ROWS) {
            rows.push({ ...row, ...(await insertDocument(db, ownerId, row)) });
          }
          await insertDocument(db, otherOwnerId, { originalFilename: 'alpha.pdf' });

          const seen: string[] = [];
          let page = await documents.listForOwner(ownerId, { limit: 2, sort });
          seen.push(...page.items.map((document) => document.id));
          while (page.nextCursor) {
            page = await documents.listForOwner(ownerId, {
              limit: 2,
              sort,
              after: page.nextCursor,
            });
            seen.push(...page.items.map((document) => document.id));
          }

          expect(seen).toEqual(expectedIds(rows, sort));
        },
      );
    });

    describe('filters', () => {
      async function listIds(filters: DocumentListFilters, owner = ownerId): Promise<string[]> {
        const page = await documents.listForOwner(owner, { limit: 100, sort: 'name_asc', filters });
        return page.items.map((document) => document.originalFilename);
      }

      beforeEach(async () => {
        await insertDocument(db, ownerId, {
          originalFilename: 'Invoice-Acme.pdf',
          status: 'completed',
          documentType: 'invoice',
        });
        await insertDocument(db, ownerId, {
          originalFilename: 'contract_2026.pdf',
          status: 'needs_review',
          documentType: 'contract',
        });
        await insertDocument(db, ownerId, {
          originalFilename: 'receipt scan.png',
          mimeType: 'image/png',
          status: 'failed',
        });
        await insertDocument(db, ownerId, {
          originalFilename: '100%-paid.jpg',
          mimeType: 'image/jpeg',
        });
        await insertDocument(db, otherOwnerId, { originalFilename: 'invoice-other.pdf' });
      });

      it("searches filenames ignoring case, only among the owner's documents", async () => {
        expect(await listIds({ search: 'INVOICE' })).toEqual(['Invoice-Acme.pdf']);
        expect(await listIds({ search: 'scan' })).toEqual(['receipt scan.png']);
      });

      it.each([
        ['%', ['100%-paid.jpg']],
        ['_', ['contract_2026.pdf']],
        ['\\', []],
      ])('treats %s in a search as a literal character', async (search, expected) => {
        expect(await listIds({ search })).toEqual(expected);
      });

      it('filters by status, type, unclassified and format', async () => {
        expect(await listIds({ status: 'failed' })).toEqual(['receipt scan.png']);
        expect(await listIds({ type: 'contract' })).toEqual(['contract_2026.pdf']);
        expect(await listIds({ type: 'unclassified' })).toEqual([
          '100%-paid.jpg',
          'receipt scan.png',
        ]);
        expect(await listIds({ format: 'image' })).toEqual(['100%-paid.jpg', 'receipt scan.png']);
        expect(await listIds({ format: 'pdf' })).toEqual(['contract_2026.pdf', 'Invoice-Acme.pdf']);
      });

      it('combines filters with AND', async () => {
        expect(await listIds({ format: 'pdf', status: 'completed', search: 'acme' })).toEqual([
          'Invoice-Acme.pdf',
        ]);
        expect(await listIds({ format: 'image', type: 'invoice' })).toEqual([]);
      });

      it('pages through filtered results with the cursor', async () => {
        const first = await documents.listForOwner(ownerId, {
          limit: 1,
          sort: 'name_asc',
          filters: { format: 'image' },
        });
        expect(first.nextCursor).not.toBeNull();
        const second = await documents.listForOwner(ownerId, {
          limit: 1,
          sort: 'name_asc',
          filters: { format: 'image' },
          ...(first.nextCursor ? { after: first.nextCursor } : {}),
        });

        expect(
          [...first.items, ...second.items].map((document) => document.originalFilename),
        ).toEqual(['100%-paid.jpg', 'receipt scan.png']);
        expect(second.nextCursor).toBeNull();
      });
    });

    it.each([0, 101, 1.5])('rejects limit %s to keep queries bounded', async (limit) => {
      await expect(documents.listForOwner(ownerId, { limit, sort: 'newest' })).rejects.toThrow(
        RangeError,
      );
    });
  });

  describe('escapeLikePattern', () => {
    it('escapes the LIKE wildcards and the escape character', () => {
      expect(escapeLikePattern('50%_off\\x')).toBe('50\\%\\_off\\\\x');
      expect(escapeLikePattern('plain')).toBe('plain');
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
