import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { ObjectNotFoundError } from './object-storage.js';
import { createS3Client, S3Storage } from './s3-storage.js';

const KEY =
  'documents/6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607/2026/0a1b2c3d-4e5f-4a6b-8c7d-8e9fa0b1c2d3/original.pdf';

function storageWithFakeClient() {
  const send = vi.fn<(command: unknown) => Promise<object>>(() => Promise.resolve({}));
  const destroy = vi.fn();
  const client = { send, destroy } as unknown as S3Client;
  return { storage: new S3Storage(client, 'documind-documents'), send, destroy };
}

describe('S3Storage', () => {
  it('puts the object into the bucket with its content type and length', async () => {
    const { storage, send } = storageWithFakeClient();
    const body = Buffer.from('%PDF-1.7');

    await storage.put(KEY, body, 'application/pdf');

    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'documind-documents',
      Key: KEY,
      Body: body,
      ContentType: 'application/pdf',
      ContentLength: body.length,
    });
  });

  it('gets the object as a stream with its length', async () => {
    const { storage, send } = storageWithFakeClient();
    send.mockResolvedValueOnce({ Body: Readable.from(['%PDF-1.7']), ContentLength: 8 });

    const object = await storage.get(KEY);

    const command = send.mock.calls[0]?.[0] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: 'documind-documents', Key: KEY });
    expect(object.size).toBe(8);
    expect(await text(object.body)).toBe('%PDF-1.7');
  });

  it('reports a missing key as ObjectNotFoundError', async () => {
    const { storage, send } = storageWithFakeClient();
    send.mockRejectedValueOnce(new NoSuchKey({ message: 'NoSuchKey', $metadata: {} }));

    await expect(storage.get(KEY)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('rejects a response without a stream or length, releasing the stream', async () => {
    const { storage, send } = storageWithFakeClient();
    const body = Readable.from(['x']);
    send.mockResolvedValueOnce({ Body: body });

    await expect(storage.get(KEY)).rejects.toThrow('no stream or no length');
    expect(body.destroyed).toBe(true);
  });

  it('deletes the object from the bucket', async () => {
    const { storage, send } = storageWithFakeClient();

    await storage.delete(KEY);

    const command = send.mock.calls[0]?.[0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: 'documind-documents', Key: KEY });
  });

  it('refuses a key the application would not generate, without calling S3', async () => {
    const { storage, send } = storageWithFakeClient();

    await expect(storage.put('../secrets', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'Refusing an unexpected storage key',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('propagates S3 errors', async () => {
    const { storage, send } = storageWithFakeClient();
    send.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(storage.put(KEY, Buffer.from('x'), 'application/pdf')).rejects.toThrow(
      'AccessDenied',
    );
  });

  it('releases the client on shutdown', () => {
    const { storage, destroy } = storageWithFakeClient();

    storage.onApplicationShutdown();

    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('createS3Client', () => {
  it('targets the configured endpoint and region with the given credentials', async () => {
    const client = createS3Client({
      endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'documind-documents',
      accessKeyId: 'access-key-id',
      secretAccessKey: 'secret',
    });

    expect(await client.config.region()).toBe('auto');
    expect(await client.config.credentials()).toMatchObject({ accessKeyId: 'access-key-id' });
    const endpoint = await client.config.endpoint?.();
    expect(endpoint?.hostname).toBe('0123456789abcdef.r2.cloudflarestorage.com');
    client.destroy();
  });
});
