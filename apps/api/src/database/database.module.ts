import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import { createDatabase } from './create-database.js';
import type { Database } from './database.types.js';

export const DATABASE = Symbol('DATABASE');

/**
 * Provides the shared Kysely instance. The pool is closed in
 * onApplicationShutdown, which Nest runs after the HTTP server has closed and
 * after beforeApplicationShutdown hooks (where the worker stops polling).
 */
@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  static forRoot(applicationName: string): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => createDatabase(config.database, applicationName),
        },
      ],
      exports: [DATABASE],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
