import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertDocument, insertJob, insertUser } from '../../test/support/factories.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { ExtractionReviewsRepository } from './extraction-reviews.repository.js';

describe('ExtractionReviewsRepository', () => {
  let db: DatabaseExecutor;
  let reviews: ExtractionReviewsRepository;
  let ownerId: string;
  let extractionId: string;

  beforeAll(() => {
    db = createTestDatabase();
    reviews = new ExtractionReviewsRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    ownerId = (await insertUser(db)).id;
    const { id: documentId } = await insertDocument(db, ownerId, { status: 'needs_review' });
    const { id: jobId } = await insertJob(db, documentId, 'succeeded');
    const row = await db
      .insertInto('document_extractions')
      .values({
        document_id: documentId,
        job_id: jobId,
        document_type: 'invoice',
        schema_version: 1,
        fields: JSON.stringify({}),
        overall_confidence: 0.5,
        classification_confidence: 0.95,
        validation_issues: JSON.stringify([]),
        ai_provider: 'test',
        ai_model: 'test',
        classification_prompt: 'test@1',
        extraction_prompt: 'test@1',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    extractionId = row.id;
  });

  it('records a decision once and never overwrites it', async () => {
    await reviews.saveField(extractionId, 'totalAmount', 80);

    const first = await reviews.decide(extractionId, { decision: 'approved', decidedBy: ownerId });
    const second = await reviews.decide(extractionId, {
      decision: 'rejected',
      decidedBy: ownerId,
      rejectReason: 'late',
    });

    expect(first).toMatchObject({ decision: 'approved', fields: { totalAmount: { value: 80 } } });
    expect(second).toBeNull();
    expect(await reviews.find(extractionId)).toMatchObject({
      decision: 'approved',
      rejectReason: null,
    });
  });

  it('creates the row with the decision when no field was reviewed', async () => {
    expect(await reviews.find(extractionId)).toBeNull();

    await reviews.decide(extractionId, { decision: 'approved', decidedBy: null });

    expect(await reviews.find(extractionId)).toMatchObject({
      decision: 'approved',
      decidedBy: null,
      fields: {},
    });
  });
});
