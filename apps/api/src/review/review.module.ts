import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { ExtractionModule } from '../extraction/extraction.module.js';
import { ExtractionReviewsRepository } from './extraction-reviews.repository.js';
import { ReviewService } from './review.service.js';

@Module({
  imports: [AuditModule, DocumentsModule, ExtractionModule],
  providers: [ExtractionReviewsRepository, ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
