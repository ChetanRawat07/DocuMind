import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { TextExtractionModule } from '../text-extraction/text-extraction.module.js';
import { DocumentAnalysisService } from './document-analysis.service.js';
import { DocumentExtractionsRepository } from './document-extractions.repository.js';

@Module({
  imports: [AiModule, AuditModule, DocumentsModule, TextExtractionModule],
  providers: [DocumentExtractionsRepository, DocumentAnalysisService],
  exports: [DocumentExtractionsRepository, DocumentAnalysisService],
})
export class ExtractionModule {}
