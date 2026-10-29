import { type DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from '../config/app-config.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SHARED_FEATURE_MODULES } from '../shared-feature-modules.js';
import { WorkerService } from './worker.service.js';

/** Root module of the worker process. Imports no HTTP controllers. */
@Module({})
export class WorkerModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        AppConfigModule.forRoot(config),
        DatabaseModule.forRoot('documind-worker'),
        ...SHARED_FEATURE_MODULES,
      ],
      providers: [WorkerService],
    };
  }
}
