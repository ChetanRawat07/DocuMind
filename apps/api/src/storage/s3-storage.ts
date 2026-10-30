import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ObjectNotFoundError, ObjectStorage, type StoredObject } from './object-storage.js';
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

  async get(key: string): Promise<StoredObject> {
    assertStorageKey(key);
    let response;
    try {
      response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (error instanceof NoSuchKey) throw new ObjectNotFoundError(key);
      throw error;
    }
    // In Node.js the SDK returns the body as a Readable (the HTTP response).
    const { Body: body, ContentLength: size } = response;
    if (!(body instanceof Readable) || size === undefined) {
      if (body instanceof Readable) body.destroy();
      throw new Error(`Unexpected response reading ${key}: no stream or no length`);
    }
    return { body, size };
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
