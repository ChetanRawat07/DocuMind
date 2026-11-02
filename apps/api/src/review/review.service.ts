import type { DocumentExtractionDto, ReviewFieldRequest } from '@documind/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import type { JsonObject } from '../database/generated/database.js';
import { type Document, DocumentsRepository } from '../documents/documents.repository.js';
import {
  type DocumentExtraction,
  DocumentExtractionsRepository,
} from '../extraction/document-extractions.repository.js';
import {
  type ExtractionReview,
  ExtractionReviewsRepository,
} from './extraction-reviews.repository.js';
import { describeFields, parseCorrection, toExtractionDto } from './review-fields.js';

export type ReviewFailure =
  | 'not_found'
  | 'no_extraction'
  | 'unknown_field'
  | 'not_in_review'
  | 'stale_extraction'
  | 'not_correctable'
  | 'invalid_value'
  | 'unreviewed_fields';

/** A review action that cannot be done; the controller maps `reason` to an HTTP status. */
export class ReviewError extends Error {
  constructor(
    readonly reason: ReviewFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

interface PendingReview {
  readonly document: Document;
  readonly extraction: DocumentExtraction;
  readonly review: ExtractionReview | null;
}

/**
 * Human review of a document's latest extraction: confirm or correct
 * flagged fields, then approve (document `completed`) or reject (`rejected`).
 *
 * Every action runs in a transaction that locks the document row, so edits
 * and the decision on one document happen one at a time, and checks that the
 * document is still in review and the reviewer acted on its current
 * extraction. Audit entries name fields, never their values.
 */
@Injectable()
export class ReviewService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseExecutor,
    private readonly documents: DocumentsRepository,
    private readonly extractions: DocumentExtractionsRepository,
    private readonly reviews: ExtractionReviewsRepository,
    private readonly auditLogs: AuditLogsRepository,
  ) {}

  async getForOwner(ownerId: string, documentId: string): Promise<DocumentExtractionDto> {
    const document = await this.documents.findByIdForOwner(ownerId, documentId);
    if (!document) throw new ReviewError('not_found', 'Document not found');
    const extraction = await this.extractions.findLatestForDocument(documentId);
    if (!extraction) {
      throw new ReviewError('no_extraction', 'The document has no extracted data yet');
    }
    return toExtractionDto(extraction, await this.reviews.find(extraction.id));
  }

  async reviewField(
    ownerId: string,
    documentId: string,
    field: string,
    request: ReviewFieldRequest,
  ): Promise<DocumentExtractionDto> {
    return this.inPendingReview(ownerId, documentId, request.extractionId, async (pending, trx) => {
      const current = describeFields(pending.extraction, pending.review).find(
        (candidate) => candidate.name === field,
      );
      if (!current) throw new ReviewError('unknown_field', 'Unknown field');

      let value = current.value;
      if (request.action === 'correct') {
        if (current.kind === 'list') {
          throw new ReviewError('not_correctable', `${field}: Lists can be confirmed, not edited`);
        }
        const parsed = parseCorrection(current.kind, request.value);
        if (!parsed.ok) throw new ReviewError('invalid_value', `${field}: ${parsed.message}`);
        value = parsed.value;
      }

      const review = await this.reviews.saveField(pending.extraction.id, field, value, trx);
      await this.audit(ownerId, documentId, 'document.field_reviewed', trx, {
        extractionId: pending.extraction.id,
        field,
        action: request.action === 'confirm' ? 'confirmed' : 'corrected',
      });
      return toExtractionDto(pending.extraction, review);
    });
  }

  /** Refused while a flagged field has been neither confirmed nor corrected. */
  async approve(ownerId: string, documentId: string, extractionId: string): Promise<Document> {
    return this.inPendingReview(ownerId, documentId, extractionId, async (pending, trx) => {
      const fields = describeFields(pending.extraction, pending.review);
      const unchecked = fields.filter((field) => field.needsReview && !field.reviewed);
      if (unchecked.length > 0) {
        throw new ReviewError(
          'unreviewed_fields',
          `Confirm or correct the flagged fields first: ${unchecked.map((f) => f.name).join(', ')}`,
        );
      }
      return this.decide(pending, 'approved', ownerId, trx, {
        correctedFields: fields.filter((field) => field.corrected).map((field) => field.name),
      });
    });
  }

  async reject(
    ownerId: string,
    documentId: string,
    extractionId: string,
    reason: string | undefined,
  ): Promise<Document> {
    return this.inPendingReview(ownerId, documentId, extractionId, (pending, trx) =>
      // The reason is free text that may quote the document, so it stays out of the audit log.
      this.decide(pending, 'rejected', ownerId, trx, { hasReason: reason !== undefined }, reason),
    );
  }

  /**
   * Approval by the worker, for an extraction confident enough to skip
   * review. Runs in the worker's transaction that stores the extraction.
   */
  async approveAutomatically(
    documentId: string,
    extractionId: string,
    overallConfidence: number,
    trx: DatabaseExecutor,
  ): Promise<void> {
    if (
      !(await this.reviews.decide(extractionId, { decision: 'approved', decidedBy: null }, trx))
    ) {
      return;
    }
    await this.auditLogs.append(
      {
        actor: { type: 'system' },
        action: 'document.approved',
        resourceType: 'document',
        resourceId: documentId,
        requestId: null,
        metadata: { extractionId, automatic: true, overallConfidence },
      },
      trx,
    );
  }

  private async decide(
    pending: PendingReview,
    decision: 'approved' | 'rejected',
    ownerId: string,
    trx: DatabaseExecutor,
    metadata: JsonObject,
    rejectReason?: string,
  ): Promise<Document> {
    // The row lock already serializes decisions; this keeps the review and the status in step if it ever did not.
    const decided = await this.reviews.decide(
      pending.extraction.id,
      { decision, decidedBy: ownerId, rejectReason },
      trx,
    );
    if (!decided) throw new ReviewError('not_in_review', 'The document is not waiting for review');
    const document = await this.documents.setStatus(
      pending.document.id,
      decision === 'approved' ? 'completed' : 'rejected',
      trx,
    );
    await this.audit(ownerId, pending.document.id, `document.${decision}`, trx, {
      extractionId: pending.extraction.id,
      ...metadata,
    });
    // Locked in this transaction, so it still exists.
    return document as Document;
  }

  private async inPendingReview<T>(
    ownerId: string,
    documentId: string,
    extractionId: string,
    work: (pending: PendingReview, trx: DatabaseExecutor) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const document = await this.documents.findByIdForOwner(ownerId, documentId, trx, {
        forUpdate: true,
      });
      if (!document) throw new ReviewError('not_found', 'Document not found');
      const extraction = await this.extractions.findLatestForDocument(documentId, trx);
      if (!extraction || extraction.id !== extractionId) {
        throw new ReviewError(
          'stale_extraction',
          'The extracted data has changed since it was loaded; reload and try again',
        );
      }
      if (document.status !== 'needs_review') {
        throw new ReviewError('not_in_review', 'The document is not waiting for review');
      }
      const review = await this.reviews.find(extraction.id, trx);
      return work({ document, extraction, review }, trx);
    });
  }

  private async audit(
    ownerId: string,
    documentId: string,
    action: string,
    trx: DatabaseExecutor,
    metadata: JsonObject,
  ): Promise<void> {
    await this.auditLogs.append(
      {
        actor: { type: 'user', userId: ownerId },
        action,
        resourceType: 'document',
        resourceId: documentId,
        requestId: null,
        metadata,
      },
      trx,
    );
  }
}
