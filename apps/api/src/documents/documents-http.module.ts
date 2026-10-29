import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { DocumentsModule } from './documents.module.js';

/** HTTP endpoints for documents; imported by the API process only. */
@Module({
  imports: [DocumentsModule],
  controllers: [DocumentsController],
})
export class DocumentsHttpModule {}
