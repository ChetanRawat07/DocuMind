import { Module } from '@nestjs/common';
import { ProcessingJobsRepository } from './processing-jobs.repository.js';

@Module({
  providers: [ProcessingJobsRepository],
  exports: [ProcessingJobsRepository],
})
export class JobsModule {}
