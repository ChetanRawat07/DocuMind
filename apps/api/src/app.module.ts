import { type DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from './config/app-config.js';
import { AppConfigModule } from './config/app-config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { SHARED_FEATURE_MODULES } from './shared-feature-modules.js';

/** Root module of the HTTP API process: shared feature modules plus HTTP-facing modules. */
@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        DatabaseModule.forRoot('documind-api'),
        ...SHARED_FEATURE_MODULES,
        HealthModule,
      ],
    };
  }
}
