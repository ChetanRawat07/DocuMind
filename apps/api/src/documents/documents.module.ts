import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentsRepository } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';
import { ProcessingQuota } from './processing-quota.js';

@Module({
  imports: [AuditModule, JobsModule, StorageModule],
  providers: [DocumentsRepository, DocumentsService, ProcessingQuota],
  exports: [DocumentsRepository, DocumentsService],
})
export class DocumentsModule {}
