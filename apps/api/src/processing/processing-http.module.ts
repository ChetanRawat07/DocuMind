import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { ProcessingController } from './processing.controller.js';

/** HTTP endpoints for the Processing screen; imported by the API process only. */
@Module({
  imports: [JobsModule],
  controllers: [ProcessingController],
})
export class ProcessingHttpModule {}
