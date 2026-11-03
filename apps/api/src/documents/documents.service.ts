import { randomUUID } from 'node:crypto';
import type { DocumentContentDisposition } from '@documind/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import {
  type EnqueueResult,
  type ProcessingJob,
  ProcessingJobsRepository,
} from '../jobs/processing-jobs.repository.js';
import {
  ObjectNotFoundError,
  ObjectStorage,
  type StoredObject,
} from '../storage/object-storage.js';
import { documentStorageKey } from '../storage/storage-key.js';
import { type Document, DocumentsRepository } from './documents.repository.js';
import { ProcessingQuota } from './processing-quota.js';
import { validateUpload } from './upload-validation.js';

/** Jobs shown in a document's history; older ones stay in the table. */
const JOB_HISTORY_LIMIT = 20;

/** Files removed at once when erasing a user's data. */
const ERASE_CONCURRENCY = 10;

/**
 * Uploads and deletions span two systems, object storage and PostgreSQL, with
 * no shared transaction. The write order keeps the database truthful:
 *
 * - Upload: object first, then the row. A row therefore never points at a
 *   missing file. If the row cannot be written, the object is removed.
 * - Delete: row first, then the object. The document disappears for the user
 *   at once. If the object cannot be removed it is logged as an orphan.
 *
 * What remains possible is an orphaned object (a crash between the two
 * steps), which costs storage but exposes nothing: no row references it.
 *
 * The processing job is created in the document's transaction (ADR-005), so
 * a stored document is always queued: there is no window in which it exists
 * without a job.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseExecutor,
    private readonly documents: DocumentsRepository,
    private readonly auditLogs: AuditLogsRepository,
    private readonly storage: ObjectStorage,
    private readonly jobs: ProcessingJobsRepository,
    private readonly quota: ProcessingQuota,
  ) {}

  /**
   * Validates and stores a file for `ownerId`. Throws UploadRejectedError for an
   * unacceptable file, ProcessingQuotaExceededError when the quota is used up.
   */
  async upload(
    ownerId: string,
    file: { readonly originalName: string; readonly content: Buffer },
  ): Promise<Document> {
    const { filename, mimeType } = validateUpload(file);
    const documentId = randomUUID();
    const storageKey = documentStorageKey({
      ownerId,
      documentId,
      uploadedAt: new Date(),
      mimeType,
    });

    await this.storage.put(storageKey, file.content, mimeType);
    try {
      return await this.db.transaction().execute(async (trx) => {
        await this.quota.assertAvailable(ownerId, trx);
        await this.documents.create(
          {
            id: documentId,
            ownerId,
            originalFilename: filename,
            mimeType,
            sizeBytes: file.content.length,
            storageKey,
          },
          trx,
        );
        const { job } = await this.jobs.enqueue(documentId, trx);
        const document = await this.documents.setStatus(documentId, 'queued', trx);
        await this.auditLogs.append(
          {
            actor: { type: 'user', userId: ownerId },
            action: 'document.uploaded',
            resourceType: 'document',
            resourceId: documentId,
            // No filename: audit entries outlive the document and keep only what is needed.
            metadata: { mimeType, sizeBytes: file.content.length, jobId: job.id },
          },
          trx,
        );
        // Inserted in this transaction, so it exists.
        return document as Document;
      });
    } catch (error) {
      await this.removeObject(storageKey, 'after a failed upload');
      throw error;
    }
  }

  /**
   * Opens the owner's document file for sending, or returns null if the
   * owner has no such document. Every access is audited before any byte is
   * sent: if the audit entry cannot be written, the file is not served. The
   * object is opened first, so a missing file records no access.
   * `recordAccess: false` is for HEAD requests, which send headers but no
   * file content, so nothing was viewed or downloaded.
   */
  async openContent(
    ownerId: string,
    documentId: string,
    disposition: DocumentContentDisposition,
    { recordAccess = true }: { readonly recordAccess?: boolean } = {},
  ): Promise<{ readonly document: Document; readonly content: StoredObject } | null> {
    const document = await this.documents.findByIdForOwner(ownerId, documentId);
    if (!document) return null;

    let content: StoredObject;
    try {
      content = await this.storage.get(document.storageKey);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        // A row without its object breaks the upload write order; it needs investigating.
        this.logger.error(`Document ${document.id} has no stored object at ${document.storageKey}`);
      }
      throw error;
    }

    if (!recordAccess) return { document, content };
    try {
      await this.auditLogs.append({
        actor: { type: 'user', userId: ownerId },
        action: disposition === 'inline' ? 'document.viewed' : 'document.downloaded',
        resourceType: 'document',
        resourceId: document.id,
        metadata: { mimeType: document.mimeType, sizeBytes: document.sizeBytes },
      });
    } catch (error) {
      content.body.destroy();
      throw error;
    }
    return { document, content };
  }

  /**
   * Queues the owner's failed, rejected (or never queued) document again. Idempotent:
   * when the document is already queued or processing, its active job is
   * returned instead of a new one, so a repeated request is harmless.
   * Returns `already_processed` for a document in review or completed, and
   * null when the owner has no such document.
   */
  async requestProcessing(
    ownerId: string,
    documentId: string,
  ): Promise<EnqueueResult | 'already_processed' | null> {
    return this.db.transaction().execute(async (trx) => {
      // The conditional update locks the row, so concurrent requests queue it once.
      if (await this.documents.requeueForOwner(ownerId, documentId, trx)) {
        // After the requeue, so repeating a request for a queued document never hits the quota.
        await this.quota.assertAvailable(ownerId, trx);
        const result = await this.jobs.enqueue(documentId, trx);
        await this.auditLogs.append(
          {
            actor: { type: 'user', userId: ownerId },
            action: 'document.processing_requested',
            resourceType: 'document',
            resourceId: documentId,
            metadata: { jobId: result.job.id },
          },
          trx,
        );
        return result;
      }
      if (!(await this.documents.findByIdForOwner(ownerId, documentId, trx))) return null;
      const active = await this.jobs.findActiveForDocument(documentId, trx);
      return active ? { job: active, created: false } : 'already_processed';
    });
  }

  /** The owner's document's recent jobs, newest first, or null if the owner has no such document. */
  async listJobs(ownerId: string, documentId: string): Promise<ProcessingJob[] | null> {
    if (!(await this.documents.findByIdForOwner(ownerId, documentId))) return null;
    return this.jobs.listForDocument(documentId, JOB_HISTORY_LIMIT);
  }

  /** Deletes the owner's document and its file. Returns false if the owner has no such document. */
  async delete(ownerId: string, documentId: string): Promise<boolean> {
    const deleted = await this.db.transaction().execute(async (trx) => {
      const document = await this.documents.deleteForOwner(ownerId, documentId, trx);
      if (document) {
        await this.auditLogs.append(
          {
            actor: { type: 'user', userId: ownerId },
            action: 'document.deleted',
            resourceType: 'document',
            resourceId: documentId,
            metadata: { mimeType: document.mimeType, sizeBytes: document.sizeBytes },
          },
          trx,
        );
      }
      return document;
    });
    if (!deleted) return false;

    await this.removeObject(deleted.storageKey, 'after deleting its document');
    return true;
  }

  /**
   * Erases everything DocuMind holds about the owner: their documents
   * (with text, extractions, reviews and jobs), their files and their user
   * row, recorded as `user.data_erased`. The audit log keeps the user's id and
   * entries, which hold no document content. The Supabase account is not
   * ours to delete: signing in again starts an empty account.
   *
   * Same order as a single delete: rows first, then files. Locking the user
   * row waits for uploads in flight, and makes a later one fail on the
   * missing user instead of leaving a document behind.
   */
  async eraseOwner(ownerId: string): Promise<{ readonly documents: number }> {
    const storageKeys = await this.db.transaction().execute(async (trx) => {
      const owner = await trx
        .selectFrom('users')
        .select('id')
        .where('id', '=', ownerId)
        .forUpdate()
        .executeTakeFirst();
      if (!owner) return [];
      const keys = await this.documents.deleteAllForOwner(ownerId, trx);
      await this.auditLogs.append(
        {
          actor: { type: 'user', userId: ownerId },
          action: 'user.data_erased',
          resourceType: 'user',
          resourceId: ownerId,
          metadata: { documents: keys.length },
        },
        trx,
      );
      await trx.deleteFrom('users').where('id', '=', ownerId).execute();
      return keys;
    });

    for (let start = 0; start < storageKeys.length; start += ERASE_CONCURRENCY) {
      await Promise.all(
        storageKeys
          .slice(start, start + ERASE_CONCURRENCY)
          .map((key) => this.removeObject(key, 'after erasing its owner')),
      );
    }
    return { documents: storageKeys.length };
  }

  /** Best effort: a failure leaves an orphaned object, which is logged for cleanup. */
  private async removeObject(storageKey: string, context: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      const cause = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Orphaned object ${storageKey}: could not remove it ${context}: ${cause}`);
    }
  }
}
