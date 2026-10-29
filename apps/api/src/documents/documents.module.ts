import { Module } from '@nestjs/common';
import { DocumentsRepository } from './documents.repository.js';

@Module({
  providers: [DocumentsRepository],
  exports: [DocumentsRepository],
})
export class DocumentsModule {}
