import { Controller, Get, Header } from '@nestjs/common';
import type { HealthResponse } from '@documind/shared';

@Controller('health')
export class HealthController {
  /**
   * Liveness: the process is up and serving HTTP. It deliberately checks no
   * dependencies; a readiness check covering the database arrives with Phase 1.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  check(): HealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
