import {
  type ApiErrorResponse,
  type DocumentContentQuery,
  documentContentQuerySchema,
  type DocumentDto,
  type DocumentListQuery,
  documentListQuerySchema,
  type DocumentListResponse,
  MAX_UPLOAD_BYTES,
  UPLOAD_FIELD_NAME,
} from '@documind/shared';
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { User } from '../users/users.repository.js';
import { contentDisposition } from './content-disposition.js';
import { decodeDocumentCursor, encodeDocumentCursor } from './document-cursor.js';
import { type Document, DocumentsRepository } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';
import { type UploadRejection, UploadRejectedError } from './upload-validation.js';

/**
 * Multipart limits. Multer's own defaults are unlimited, so every limit is
 * explicit: one file part, no other fields, and a size cap so a request
 * cannot exhaust memory. Files are buffered in memory (no `dest`), which the
 * size cap bounds. Filenames are decoded as UTF-8.
 */
const UPLOAD_INTERCEPTOR = FileInterceptor(UPLOAD_FIELD_NAME, {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1, headerPairs: 50 },
  defParamCharset: 'utf8',
});

/** The parts of multer's file object this controller reads. */
interface UploadedFilePart {
  readonly originalname: string;
  readonly buffer: Buffer;
}

const REJECTION_STATUS: Record<UploadRejection, (message: string) => Error> = {
  empty: (message) => new BadRequestException(message),
  invalid_filename: (message) => new BadRequestException(message),
  too_large: (message) => new PayloadTooLargeException(message),
  unsupported_type: (message) => new UnsupportedMediaTypeException(message),
  content_mismatch: (message) => new UnsupportedMediaTypeException(message),
};

/**
 * Document endpoints. Ownership is enforced by the repository's owner
 * filter, never by checking a fetched row afterwards.
 */
@Controller('documents')
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly documents: DocumentsRepository,
    private readonly documentsService: DocumentsService,
  ) {}

  /**
   * Multipart upload with one `file` part. The global auth guard runs before
   * the interceptor, so an unauthenticated request is rejected before its
   * body is read.
   */
  @Post()
  @UseInterceptors(UPLOAD_INTERCEPTOR)
  async upload(
    @CurrentUser() user: User,
    @UploadedFile() file: UploadedFilePart | undefined,
  ): Promise<DocumentDto> {
    if (!file) {
      throw new BadRequestException(`${UPLOAD_FIELD_NAME}: A file is required`);
    }
    try {
      const document = await this.documentsService.upload(user.id, {
        originalName: file.originalname,
        content: file.buffer,
      });
      return toDocumentDto(document);
    } catch (error) {
      if (error instanceof UploadRejectedError) {
        throw REJECTION_STATUS[error.reason](error.message);
      }
      throw error;
    }
  }

  @Get()
  async list(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(documentListQuerySchema)) query: DocumentListQuery,
  ): Promise<DocumentListResponse> {
    let after;
    if (query.cursor !== undefined) {
      after = decodeDocumentCursor(query.sort, query.cursor);
      if (!after) {
        throw new BadRequestException('cursor: Invalid cursor');
      }
    }

    const page = await this.documents.listForOwner(user.id, {
      limit: query.limit,
      sort: query.sort,
      filters: {
        ...(query.q !== undefined ? { search: query.q } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.type !== undefined ? { type: query.type } : {}),
        ...(query.format !== undefined ? { format: query.format } : {}),
      },
      ...(after ? { after } : {}),
    });
    return {
      items: page.items.map(toDocumentDto),
      nextCursor: page.nextCursor ? encodeDocumentCursor(query.sort, page.nextCursor) : null,
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

  /**
   * The file itself, streamed from storage. `disposition=inline` is for
   * previews, `attachment` (the default) for downloads; each access is
   * audited. The Content-Type is the one detected from the file's bytes at
   * upload, and helmet's `nosniff` stops browsers from second-guessing it.
   */
  @Get(':id/content')
  async content(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(documentContentQuerySchema)) query: DocumentContentQuery,
    @Req() request: Request,
  ): Promise<StreamableFile> {
    // Express answers HEAD with this GET handler; it sends no content, so it is not an access.
    const opened = await this.documentsService.openContent(user.id, id, query.disposition, {
      recordAccess: request.method !== 'HEAD',
    });
    if (!opened) {
      throw new NotFoundException('Document not found');
    }
    const { document, content } = opened;
    return new StreamableFile(content.body, {
      type: document.mimeType,
      length: content.size,
      disposition: contentDisposition(query.disposition, document.originalFilename),
    }).setErrorHandler((error, response) => {
      // The Express adapter passes the Express response; Nest types only its common subset.
      this.handleStreamError(id, error, response as unknown as Response);
    });
  }

  /**
   * A storage read that fails before the first byte gets the standard 500
   * (Nest's default would be a 400). Once bytes are sent the status cannot
   * change, so the connection is cut: the client then sees fewer bytes than
   * Content-Length promised and knows the download failed, instead of waiting.
   */
  private handleStreamError(documentId: string, error: Error, response: Response): void {
    this.logger.error(`Reading the file of document ${documentId} failed: ${error.message}`);
    if (response.destroyed) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const body: ApiErrorResponse = {
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
    };
    // Nest has already set the file's headers; json() would keep its Content-Type.
    for (const header of ['Content-Type', 'Content-Length', 'Content-Disposition']) {
      response.removeHeader(header);
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }

  /** Same 404 for another user's document and a missing one. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    if (!(await this.documentsService.delete(user.id, id))) {
      throw new NotFoundException('Document not found');
    }
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
