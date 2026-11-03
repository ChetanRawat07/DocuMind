import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsRepository } from './analytics.repository.js';

/** Analytics endpoints; read-only, imported by the API process only. */
@Module({
  providers: [AnalyticsRepository],
  controllers: [AnalyticsController],
})
export class AnalyticsHttpModule {}
