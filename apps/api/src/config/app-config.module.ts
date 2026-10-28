import { type DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from './app-config.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Exposes the already-validated configuration to the DI container.
 * Validation happens in the entrypoint (before Nest boots) so the logger and
 * port can be configured from it too.
 */
@Module({})
export class AppConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
