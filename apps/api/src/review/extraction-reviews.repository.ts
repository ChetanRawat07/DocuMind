import type { ReviewDecision } from '@documind/shared';
import { Inject, Injectable } from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import type { ExtractionReviews, JsonValue } from '../database/generated/database.js';

export interface ExtractionReview {
  readonly extractionId: string;
  /** Confirmed or corrected fields and the value the reviewer settled on. Document content. */
  readonly fields: Readonly<Record<string, { readonly value: JsonValue }>>;
  readonly decision: ReviewDecision | null;
  /** The reviewing user; null for an automatic approval. */
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly rejectReason: string | null;
}

/**
 * A reviewer's work on one extraction. The row is created by the first
 * field action or by the decision, whichever comes first. Callers check the
 * document's status under a row lock; this repository does not.
 */
@Injectable()
export class ExtractionReviewsRepository {
  constructor(@Inject(DATABASE) private readonly db: DatabaseExecutor) {}

  async find(extractionId: string, executor = this.db): Promise<ExtractionReview | null> {
    const row = await executor
      .selectFrom('extraction_reviews')
      .selectAll()
      .where('extraction_id', '=', extractionId)
      .executeTakeFirst();
    return row ? toReview(row) : null;
  }

  /** Records a field's reviewed value, replacing any earlier one; other fields are kept. */
  async saveField(
    extractionId: string,
    field: string,
    value: JsonValue,
    executor = this.db,
  ): Promise<ExtractionReview> {
    const row = await executor
      .insertInto('extraction_reviews')
      .values({ extraction_id: extractionId, fields: JSON.stringify({ [field]: { value } }) })
      .onConflict((conflict) =>
        conflict
          .column('extraction_id')
          .doUpdateSet({ fields: sql`extraction_reviews.fields || excluded.fields` }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toReview(row);
  }

  /** Records the decision once. Returns null when the extraction already has one. */
  async decide(
    extractionId: string,
    decision: {
      readonly decision: ReviewDecision;
      readonly decidedBy: string | null;
      readonly rejectReason?: string | undefined;
    },
    executor = this.db,
  ): Promise<ExtractionReview | null> {
    const values = {
      decision: decision.decision,
      decided_by: decision.decidedBy,
      decided_at: sql<Date>`now()`,
      reject_reason: decision.rejectReason ?? null,
    };
    const row = await executor
      .insertInto('extraction_reviews')
      .values({ extraction_id: extractionId, ...values })
      .onConflict((conflict) =>
        conflict
          .column('extraction_id')
          .doUpdateSet(values)
          .where('extraction_reviews.decision', 'is', null),
      )
      .returningAll()
      .executeTakeFirst();
    return row ? toReview(row) : null;
  }
}

function toReview(row: Selectable<ExtractionReviews>): ExtractionReview {
  return {
    extractionId: row.extraction_id,
    // The CHECK guarantees an object; only this repository writes its entries.
    fields: row.fields as Record<string, { value: JsonValue }>,
    decision: row.decision as ReviewDecision | null,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    rejectReason: row.reject_reason,
  };
}
