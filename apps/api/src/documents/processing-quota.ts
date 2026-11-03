import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { DatabaseExecutor } from '../database/database.types.js';

/** Uploads plus reprocessing requests per user in any 24 hours: each one runs OCR and the AI. */
export const DAILY_PROCESSING_QUOTA = 50;

export class ProcessingQuotaExceededError extends Error {
  constructor() {
    super(
      `Processing limit reached: ${String(DAILY_PROCESSING_QUOTA)} documents per 24 hours. Try again later.`,
    );
    this.name = 'ProcessingQuotaExceededError';
  }
}

/**
 * Counts from the audit log, which is append-only: deleting documents or
 * erasing data does not give the quota back.
 */
@Injectable()
export class ProcessingQuota {
  /**
   * Throws ProcessingQuotaExceededError when the owner has used the quota.
   * Call inside the transaction that records the new request. Locking the
   * owner's row serializes their requests, so concurrent uploads cannot
   * both pass the count. `FOR NO KEY UPDATE` does not block the key-share
   * locks taken by inserts that reference the user.
   */
  async assertAvailable(ownerId: string, trx: DatabaseExecutor): Promise<void> {
    const owner = await trx
      .selectFrom('users')
      .select('id')
      .where('id', '=', ownerId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    // Only after an erasure committed while this request was in flight.
    if (!owner) throw new Error(`User ${ownerId} no longer exists`);

    const { used } = (
      await sql<{ used: string }>`
        SELECT count(*) AS used FROM audit_logs
        WHERE actor_user_id = ${ownerId}
          AND action IN ('document.uploaded', 'document.processing_requested')
          AND occurred_at > now() - interval '24 hours'
      `.execute(trx)
    ).rows[0] ?? { used: '0' };
    if (Number(used) >= DAILY_PROCESSING_QUOTA) throw new ProcessingQuotaExceededError();
  }
}
