import { Module } from '@nestjs/common';
import { DocumentExtractionsRepository } from './document-extractions.repository.js';

@Module({
  providers: [DocumentExtractionsRepository],
  exports: [DocumentExtractionsRepository],
})
export class ExtractionModule {}
