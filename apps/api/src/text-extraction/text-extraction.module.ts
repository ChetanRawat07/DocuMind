import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentTextsRepository } from './document-texts.repository.js';
import { TextExtractionService } from './text-extraction.service.js';

@Module({
  imports: [AuditModule, DocumentsModule, StorageModule],
  providers: [DocumentTextsRepository, TextExtractionService],
  exports: [DocumentTextsRepository, TextExtractionService],
})
export class TextExtractionModule {}
