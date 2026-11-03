import { type DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { runEntrypoint } from '../common/bootstrap/run-entrypoint.js';
import { createLogger } from '../common/logging/create-logger.js';
import { type AppConfig, loadConfig } from '../config/app-config.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { DATABASE, DatabaseModule } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { ObjectStorage } from '../storage/object-storage.js';
import { findOrphans } from '../storage/orphan-sweep.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({})
class SweepStorageCliModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: SweepStorageCliModule,
      imports: [
        AppConfigModule.forRoot(config),
        DatabaseModule.forRoot('documind-sweep'),
        StorageModule,
      ],
    };
  }
}

/**
 * `npm run storage:sweep [-- --delete]`: lists stored files that no document
 * references and are over a day old, one JSON line each. Deletes them only
 * with `--delete`; a dry run is the default, so a misconfigured database
 * (every file looking unreferenced) cannot wipe storage by accident.
 */
runEntrypoint('storage-sweep', async () => {
  const remove = process.argv.includes('--delete');
  const config = loadConfig(process.env);
  const app = await NestFactory.createApplicationContext(SweepStorageCliModule.register(config), {
    logger: createLogger(config, 'worker'),
  });
  try {
    const storage = app.get(ObjectStorage);
    let count = 0;
    for await (const orphan of findOrphans(storage, app.get<DatabaseExecutor>(DATABASE))) {
      if (remove) await storage.delete(orphan.key);
      count += 1;
      process.stdout.write(
        `${JSON.stringify({ key: orphan.key, lastModified: orphan.lastModified, deleted: remove })}\n`,
      );
    }
    process.stdout.write(
      `${JSON.stringify({ orphans: count, deleted: remove ? count : 0, dryRun: !remove })}\n`,
    );
  } finally {
    await app.close();
  }
});
