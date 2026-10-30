import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ObjectStorage } from './object-storage.js';
import { assertStorageKey } from './storage-key.js';

export interface S3StorageOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** Creates the client for an S3-compatible service such as Cloudflare R2. */
export function createS3Client(options: S3StorageOptions): S3Client {
  return new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    // Send checksums only where S3 requires them; S3-compatible services do
    // not all support the SDK's newer default checksum headers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
  });
}

/**
 * Objects in a private bucket. Credentials stay on the server; the browser
 * never talks to the bucket.
 */
export class S3Storage extends ObjectStorage implements OnApplicationShutdown {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {
    super();
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    assertStorageKey(key);
    // S3 answers 204 for a missing key, so this is already idempotent.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
