import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentsRepository } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [AuditModule, StorageModule],
  providers: [DocumentsRepository, DocumentsService],
  exports: [DocumentsRepository, DocumentsService],
})
export class DocumentsModule {}
