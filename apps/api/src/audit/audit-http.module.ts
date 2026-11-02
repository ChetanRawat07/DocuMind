import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { AuditController } from './audit.controller.js';
import { AuditModule } from './audit.module.js';

/** HTTP endpoints for reading the audit log; imported by the API process only. */
@Module({
  imports: [AuditModule, DocumentsModule],
  controllers: [AuditController],
})
export class AuditHttpModule {}
