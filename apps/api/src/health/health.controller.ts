import type { HealthResponse } from '@documind/shared';
import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: DatabaseExecutor) {}

  /**
   * Liveness: the process is up and serving HTTP. Checks no dependencies, so a
   * database outage does not make the platform restart a healthy process.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  live(): HealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * Readiness: the process can serve real traffic (the database answers).
   * Failure is a 503; the cause is logged server-side, never returned.
   */
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(): Promise<HealthResponse> {
    try {
      await sql`SELECT 1`.execute(this.db);
    } catch (error) {
      throw new ServiceUnavailableException('Database unavailable', { cause: error });
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
