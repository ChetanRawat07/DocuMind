import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import { PollingLoop } from './polling-loop.js';

/** Owns the worker's poll loop and ties it to the Nest application lifecycle. */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly loop: PollingLoop;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.loop = new PollingLoop({
      tick: () => this.pollOnce(),
      idleDelayMs: config.worker.pollIntervalMs,
      onError: (error) => {
        this.logger.error(
          error instanceof Error ? error.message : 'Non-error value thrown',
          error instanceof Error ? error.stack : undefined,
        );
      },
    });
  }

  onApplicationBootstrap(): void {
    this.loop.start();
    this.logger.log('Worker poll loop started');
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Stopping worker poll loop${signal ? ` (${signal})` : ''}`);
    await this.loop.stop();
    this.logger.log('Worker poll loop stopped');
  }

  /**
   * Skeleton only. Phase 9 replaces this with claiming one job from the
   * PostgreSQL job table (FOR UPDATE SKIP LOCKED) and processing it.
   */
  private pollOnce(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
