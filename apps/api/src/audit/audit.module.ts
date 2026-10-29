import { Module } from '@nestjs/common';
import { AuditLogsRepository } from './audit-logs.repository.js';

@Module({
  providers: [AuditLogsRepository],
  exports: [AuditLogsRepository],
})
export class AuditModule {}
