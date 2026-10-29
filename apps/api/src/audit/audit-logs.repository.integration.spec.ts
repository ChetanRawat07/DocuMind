import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { AuditLogsRepository, type NewAuditLogEntry } from './audit-logs.repository.js';

describe('AuditLogsRepository', () => {
  let db: DatabaseExecutor;
  let auditLogs: AuditLogsRepository;
  const documentId = randomUUID();
  const userId = randomUUID();

  const entry = (action: string): NewAuditLogEntry => ({
    actor: { type: 'user', userId },
    action,
    resourceType: 'document',
    resourceId: documentId,
    requestId: 'req-123',
    metadata: { filename: 'invoice.pdf' },
  });

  beforeAll(() => {
    db = createTestDatabase();
    auditLogs = new AuditLogsRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('appends an entry and reads it back unchanged', async () => {
    const appended = await auditLogs.append(entry('document.uploaded'));

    expect(appended).toMatchObject({
      actor: { type: 'user', userId },
      action: 'document.uploaded',
      resourceType: 'document',
      resourceId: documentId,
      requestId: 'req-123',
      metadata: { filename: 'invoice.pdf' },
    });
  });

  it('records system actions without a user', async () => {
    const appended = await auditLogs.append({ ...entry('job.failed'), actor: { type: 'system' } });

    expect(appended.actor).toEqual({ type: 'system' });
  });

  it("lists a resource's history newest first, within the limit", async () => {
    // One transaction gives all three the same occurred_at, so the id tiebreaker decides order.
    await db.transaction().execute(async (trx) => {
      for (const action of ['document.uploaded', 'document.processed', 'document.reviewed']) {
        await auditLogs.append(entry(action), trx);
      }
    });
    await auditLogs.append({ ...entry('document.uploaded'), resourceId: randomUUID() });

    const history = await auditLogs.listForResource('document', documentId, 2);

    expect(history.map((item) => item.action)).toEqual(['document.reviewed', 'document.processed']);
  });

  it.each([0, 101])('rejects limit %s to keep queries bounded', async (limit) => {
    await expect(auditLogs.listForResource('document', documentId, limit)).rejects.toThrow(
      RangeError,
    );
  });
});
