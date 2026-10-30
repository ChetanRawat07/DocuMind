import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { ObjectStorage } from '../storage/object-storage.js';
import { documentStorageKey } from '../storage/storage-key.js';
import { type Document, DocumentsRepository } from './documents.repository.js';
import { validateUpload } from './upload-validation.js';

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
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseExecutor,
    private readonly documents: DocumentsRepository,
    private readonly auditLogs: AuditLogsRepository,
    private readonly storage: ObjectStorage,
  ) {}

  /** Validates and stores a file for `ownerId`. Throws UploadRejectedError for an unacceptable file. */
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
        const document = await this.documents.create(
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
        await this.auditLogs.append(
          {
            actor: { type: 'user', userId: ownerId },
            action: 'document.uploaded',
            resourceType: 'document',
            resourceId: documentId,
            requestId: null,
            // No filename: audit entries outlive the document and keep only what is needed.
            metadata: { mimeType, sizeBytes: file.content.length },
          },
          trx,
        );
        return document;
      });
    } catch (error) {
      await this.removeObject(storageKey, 'after a failed upload');
      throw error;
    }
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
            requestId: null,
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
