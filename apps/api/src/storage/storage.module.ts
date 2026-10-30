import { Module } from '@nestjs/common';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import { FilesystemStorage } from './filesystem-storage.js';
import { ObjectStorage } from './object-storage.js';
import { createS3Client, S3Storage } from './s3-storage.js';

/** Provides ObjectStorage, backed by the driver chosen in configuration. */
@Module({
  providers: [
    {
      provide: ObjectStorage,
      inject: [APP_CONFIG],
      useFactory: ({ storage }: AppConfig): ObjectStorage =>
        storage.driver === 'filesystem'
          ? new FilesystemStorage(storage.root)
          : new S3Storage(createS3Client(storage), storage.bucket),
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
