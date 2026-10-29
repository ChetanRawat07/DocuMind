import { runEntrypoint } from '../common/bootstrap/run-entrypoint.js';
import { loadConfig } from '../config/app-config.js';
import { createDatabase } from './create-database.js';

/*
 * Development seed: one demo user with documents in representative states.
 *
 * - Fixed ids and ON CONFLICT DO NOTHING make it safe to run repeatedly.
 * - Refuses to run in production.
 * - Data is synthetic. Storage keys do not point at real objects (storage
 *   arrives in Phase 4), and the demo user only becomes able to sign in once
 *   a matching Supabase Auth user exists (Phase 2).
 */

const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';
const INVOICE_ID = '00000000-0000-4000-8000-000000000101';
const CONTRACT_ID = '00000000-0000-4000-8000-000000000102';
const PURCHASE_ORDER_ID = '00000000-0000-4000-8000-000000000103';
const INVOICE_JOB_ID = '00000000-0000-4000-8000-000000000201';
const CONTRACT_JOB_ID = '00000000-0000-4000-8000-000000000202';
const PURCHASE_ORDER_JOB_ID = '00000000-0000-4000-8000-000000000203';

const storageKey = (documentId: string): string =>
  `documents/${DEMO_USER_ID}/2026/${documentId}/original.pdf`;

runEntrypoint('seed', async () => {
  const config = loadConfig(process.env);
  if (config.nodeEnv === 'production') {
    throw new Error('Refusing to seed when NODE_ENV=production');
  }

  const db = createDatabase(config.database, 'documind-seed');
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('users')
        .values({ id: DEMO_USER_ID, email: 'demo@documind.local', display_name: 'Demo User' })
        .onConflict((conflict) => conflict.doNothing())
        .execute();

      const processedAt = new Date('2026-10-20T10:05:00.000Z');
      await trx
        .insertInto('documents')
        .values([
          {
            id: INVOICE_ID,
            user_id: DEMO_USER_ID,
            original_filename: 'invoice-INV-1023.pdf',
            mime_type: 'application/pdf',
            size_bytes: 184_320,
            storage_key: storageKey(INVOICE_ID),
            document_type: 'invoice',
            status: 'completed',
            processed_at: processedAt,
            created_at: new Date('2026-10-20T10:00:00.000Z'),
          },
          {
            id: CONTRACT_ID,
            user_id: DEMO_USER_ID,
            original_filename: 'master-services-agreement.pdf',
            mime_type: 'application/pdf',
            size_bytes: 512_000,
            storage_key: storageKey(CONTRACT_ID),
            status: 'queued',
            created_at: new Date('2026-10-21T09:00:00.000Z'),
          },
          {
            id: PURCHASE_ORDER_ID,
            user_id: DEMO_USER_ID,
            original_filename: 'po-7781-scan.pdf',
            mime_type: 'application/pdf',
            size_bytes: 2_097_152,
            storage_key: storageKey(PURCHASE_ORDER_ID),
            status: 'failed',
            processed_at: new Date('2026-10-22T08:03:00.000Z'),
            created_at: new Date('2026-10-22T08:00:00.000Z'),
          },
        ])
        .onConflict((conflict) => conflict.doNothing())
        .execute();

      await trx
        .insertInto('processing_jobs')
        .values([
          {
            id: INVOICE_JOB_ID,
            document_id: INVOICE_ID,
            status: 'succeeded',
            attempts: 1,
            started_at: new Date('2026-10-20T10:00:05.000Z'),
            finished_at: processedAt,
          },
          { id: CONTRACT_JOB_ID, document_id: CONTRACT_ID, status: 'queued' },
          {
            id: PURCHASE_ORDER_JOB_ID,
            document_id: PURCHASE_ORDER_ID,
            status: 'failed',
            stage: 'ocr',
            attempts: 3,
            last_error_code: 'OCR_FAILED',
            last_error_message: 'No readable text found on any page',
            started_at: new Date('2026-10-22T08:00:05.000Z'),
            finished_at: new Date('2026-10-22T08:03:00.000Z'),
          },
        ])
        .onConflict((conflict) => conflict.doNothing())
        .execute();

      await trx
        .insertInto('document_extractions')
        .values({
          document_id: INVOICE_ID,
          job_id: INVOICE_JOB_ID,
          document_type: 'invoice',
          schema_version: 1,
          fields: JSON.stringify({
            vendor: { value: 'ABC Pvt Ltd', confidence: 0.98 },
            invoiceNumber: { value: 'INV-1023', confidence: 0.99 },
            invoiceDate: { value: '2026-10-20', confidence: 0.97 },
            total: { value: 58_200, confidence: 0.72 },
            currency: { value: 'INR', confidence: 0.95 },
          }),
          overall_confidence: 0.92,
          ai_provider: 'seed',
          ai_model: 'synthetic',
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();

      // Audit entries have generated ids, so they are only added on the first run.
      const auditCount = await trx
        .selectFrom('audit_logs')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('actor_user_id', '=', DEMO_USER_ID)
        .executeTakeFirstOrThrow();
      if (auditCount.count === '0') {
        await trx
          .insertInto('audit_logs')
          .values(
            [INVOICE_ID, CONTRACT_ID, PURCHASE_ORDER_ID].map((documentId) => ({
              actor_type: 'user',
              actor_user_id: DEMO_USER_ID,
              action: 'document.uploaded',
              resource_type: 'document',
              resource_id: documentId,
              metadata: JSON.stringify({ source: 'seed' }),
            })),
          )
          .execute();
      }
    });
    process.stdout.write(`Seeded demo user ${DEMO_USER_ID} (demo@documind.local)\n`);
  } finally {
    await db.destroy();
  }
});
