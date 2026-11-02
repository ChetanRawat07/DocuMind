import {
  type ApproveExtractionRequest,
  approveExtractionRequestSchema,
  type DocumentDto,
  type DocumentExtractionDto,
  rejectExtractionRequestSchema,
  type ReviewFieldRequest,
  reviewFieldRequestSchema,
} from '@documind/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { toDocumentDto } from '../documents/documents.controller.js';
import type { User } from '../users/users.repository.js';
import { ReviewError, type ReviewFailure, ReviewService } from './review.service.js';

const FAILURE_STATUS: Record<ReviewFailure, (message: string) => Error> = {
  not_found: (message) => new NotFoundException(message),
  no_extraction: (message) => new NotFoundException(message),
  unknown_field: (message) => new NotFoundException(message),
  not_in_review: (message) => new ConflictException(message),
  stale_extraction: (message) => new ConflictException(message),
  unreviewed_fields: (message) => new ConflictException(message),
  not_correctable: (message) => new BadRequestException(message),
  invalid_value: (message) => new BadRequestException(message),
};

async function mapReviewErrors<T>(action: Promise<T>): Promise<T> {
  try {
    return await action;
  } catch (error) {
    if (error instanceof ReviewError) throw FAILURE_STATUS[error.reason](error.message);
    throw error;
  }
}

/**
 * Review of a document's latest extraction. Same 404 for another user's
 * document and a missing one, as everywhere. Mutations name the extraction
 * they act on and return 409 when it is no longer the current one, or when
 * the document is no longer in review.
 */
@Controller('documents/:id/extraction')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get()
  get(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DocumentExtractionDto> {
    return mapReviewErrors(this.review.getForOwner(user.id, id));
  }

  /** Confirms or corrects one field; returns the extraction with its updated review state. */
  @Put('fields/:field')
  reviewField(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('field') field: string,
    @Body(new ZodValidationPipe(reviewFieldRequestSchema)) body: ReviewFieldRequest,
  ): Promise<DocumentExtractionDto> {
    return mapReviewErrors(this.review.reviewField(user.id, id, field, body));
  }

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(approveExtractionRequestSchema)) body: ApproveExtractionRequest,
  ): Promise<DocumentDto> {
    return toDocumentDto(
      await mapReviewErrors(this.review.approve(user.id, id, body.extractionId)),
    );
  }

  /** The document becomes `rejected`; `POST /documents/:id/jobs` processes it again. */
  @Post('reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(rejectExtractionRequestSchema))
    body: z.output<typeof rejectExtractionRequestSchema>,
  ): Promise<DocumentDto> {
    return toDocumentDto(
      await mapReviewErrors(this.review.reject(user.id, id, body.extractionId, body.reason)),
    );
  }
}
