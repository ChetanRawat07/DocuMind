import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertDocument, insertJob, insertUser } from '../../test/support/factories.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import {
  DocumentExtractionsRepository,
  type NewDocumentExtraction,
} from './document-extractions.repository.js';

describe('DocumentExtractionsRepository', () => {
  let db: DatabaseExecutor;
  let extractions: DocumentExtractionsRepository;
  let documentId: string;

  const extractionFor = (jobId: string, total: number): NewDocumentExtraction => ({
    documentId,
    jobId,
    documentType: 'invoice',
    schemaVersion: 1,
    fields: {
      total: { value: total, confidence: 0.72 },
      lineItems: { value: [{ sku: 'A-1', quantity: 2 }], confidence: 0.9 },
    },
    overallConfidence: 0.81,
    aiProvider: 'ollama',
    aiModel: 'test-model',
  });

  beforeAll(() => {
    db = createTestDatabase();
    extractions = new DocumentExtractionsRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const owner = await insertUser(db);
    documentId = (await insertDocument(db, owner.id)).id;
  });

  it('stores the extraction with its nested JSON intact', async () => {
    const { id: jobId } = await insertJob(db, documentId, 'succeeded');

    const { extraction, created } = await extractions.insertOnce(extractionFor(jobId, 58_200));

    expect(created).toBe(true);
    expect(extraction.fields).toEqual(extractionFor(jobId, 58_200).fields);
    expect(extraction.overallConfidence).toBe(0.81);
  });

  it('returns the stored extraction when a job persists its result twice', async () => {
    const { id: jobId } = await insertJob(db, documentId, 'succeeded');
    const first = await extractions.insertOnce(extractionFor(jobId, 58_200));

    const retry = await extractions.insertOnce(extractionFor(jobId, 99_999));

    expect(retry.created).toBe(false);
    expect(retry.extraction.id).toBe(first.extraction.id);
    expect(retry.extraction.fields).toEqual(first.extraction.fields);
  });

  it('returns the most recent extraction for a document', async () => {
    const { id: firstJobId } = await insertJob(db, documentId, 'succeeded');
    await extractions.insertOnce(extractionFor(firstJobId, 1));
    const { id: secondJobId } = await insertJob(db, documentId, 'succeeded');
    const latest = await extractions.insertOnce(extractionFor(secondJobId, 2));

    expect((await extractions.findLatestForDocument(documentId))?.id).toBe(latest.extraction.id);
  });
});
