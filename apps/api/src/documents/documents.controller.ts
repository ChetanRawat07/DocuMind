import {
  type DocumentDto,
  type DocumentListQuery,
  documentListQuerySchema,
  type DocumentListResponse,
} from '@documind/shared';
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { User } from '../users/users.repository.js';
import { decodeDocumentCursor, encodeDocumentCursor } from './document-cursor.js';
import { type Document, DocumentsRepository } from './documents.repository.js';

/**
 * Read-only document endpoints. Upload and delete arrive in Phase 4.
 * Ownership is enforced by the repository's owner filter, never by checking
 * a fetched row afterwards.
 */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsRepository) {}

  @Get()
  async list(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(documentListQuerySchema)) query: DocumentListQuery,
  ): Promise<DocumentListResponse> {
    let after;
    if (query.cursor !== undefined) {
      after = decodeDocumentCursor(query.cursor);
      if (!after) {
        throw new BadRequestException('cursor: Invalid cursor');
      }
    }

    const page = await this.documents.listForOwner(user.id, {
      limit: query.limit,
      ...(after ? { after } : {}),
    });
    return {
      items: page.items.map(toDocumentDto),
      nextCursor: page.nextCursor ? encodeDocumentCursor(page.nextCursor) : null,
    };
  }

  /**
   * Another user's document and a nonexistent one both return the same 404,
   * so the response does not reveal whether an id exists.
   */
  @Get(':id')
  async get(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DocumentDto> {
    const document = await this.documents.findByIdForOwner(user.id, id);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return toDocumentDto(document);
  }
}

function toDocumentDto(document: Document): DocumentDto {
  return {
    id: document.id,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    documentType: document.documentType,
    status: document.status,
    processedAt: document.processedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
