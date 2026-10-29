import { type DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import type { AppConfig } from './config/app-config.js';
import { AppConfigModule } from './config/app-config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentsHttpModule } from './documents/documents-http.module.js';
import { HealthModule } from './health/health.module.js';
import { SHARED_FEATURE_MODULES } from './shared-feature-modules.js';
import { UsersHttpModule } from './users/users-http.module.js';

/**
 * Root module of the HTTP API process: shared feature modules plus HTTP-facing
 * modules. AuthModule registers a global guard, so every route requires
 * authentication unless marked @Public().
 */
@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        DatabaseModule.forRoot('documind-api'),
        ...SHARED_FEATURE_MODULES,
        AuthModule,
        HealthModule,
        UsersHttpModule,
        DocumentsHttpModule,
      ],
    };
  }
}
