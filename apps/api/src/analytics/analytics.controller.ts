import { type Analytics, type AnalyticsQuery, analyticsQuerySchema } from '@documind/shared';
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { User } from '../users/users.repository.js';
import { AnalyticsRepository, UnknownTimeZoneError } from './analytics.repository.js';

/** The signed-in user's analytics; never another user's data. */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsRepository) {}

  @Get()
  async get(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<Analytics> {
    try {
      const result = await this.analytics.forUser(user.id, query.days, query.tz);
      return { days: query.days, timezone: query.tz, ...result };
    } catch (error) {
      if (error instanceof UnknownTimeZoneError)
        throw new BadRequestException('tz: Unknown timezone');
      throw error;
    }
  }
}
