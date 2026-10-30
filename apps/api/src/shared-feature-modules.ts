import { AuditModule } from './audit/audit.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { ExtractionModule } from './extraction/extraction.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TextExtractionModule } from './text-extraction/text-extraction.module.js';
import { UsersModule } from './users/users.module.js';

/** Feature modules shared by both processes (ADR-001); neither may depend on HTTP code. */
export const SHARED_FEATURE_MODULES = [
  UsersModule,
  DocumentsModule,
  JobsModule,
  ExtractionModule,
  AuditModule,
  StorageModule,
  TextExtractionModule,
];
