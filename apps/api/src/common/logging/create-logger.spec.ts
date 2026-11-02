import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { withCorrelation } from '../correlation/correlation.js';
import { createLogger } from './create-logger.js';

const JSON_CONFIG = { log: { level: 'log', format: 'json' } } as AppConfig;

/** Captures what the logger writes to stdout, one parsed JSON object per line. */
function captureJsonLines() {
  const lines: Record<string, unknown>[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    for (const line of String(chunk).split('\n').filter(Boolean)) {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    return true;
  });
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('writes one JSON object per line, with structured fields at the top level', () => {
    const lines = captureJsonLines();

    createLogger(JSON_CONFIG, 'worker').log('Job succeeded', { durationMs: 1200 }, 'Processor');

    expect(lines).toEqual([
      expect.objectContaining({
        level: 'log',
        message: 'Job succeeded',
        context: 'Processor',
        durationMs: 1200,
      }),
    ]);
    expect(lines[0]).not.toHaveProperty('requestId');
  });

  it('adds the request and job ids of the work in progress, including after an await', async () => {
    const lines = captureJsonLines();
    const logger = createLogger(JSON_CONFIG, 'worker');

    await withCorrelation({ requestId: 'req-1' }, () =>
      withCorrelation({ jobId: 'job-1' }, async () => {
        await Promise.resolve();
        logger.log('Inside');
      }),
    );
    logger.log('Outside');

    expect(lines[0]).toMatchObject({ message: 'Inside', requestId: 'req-1', jobId: 'job-1' });
    expect(lines[1]).not.toHaveProperty('requestId');
  });

  it('lets explicit fields win over the context', () => {
    const lines = captureJsonLines();

    withCorrelation({ jobId: 'current' }, () => {
      createLogger(JSON_CONFIG, 'worker').warn('Lease expired', { jobId: 'expired' });
    });

    expect(lines[0]).toMatchObject({ jobId: 'expired' });
  });

  it('masks secrets passed in structured fields', () => {
    const lines = captureJsonLines();

    createLogger(JSON_CONFIG, 'api').log('Called', {
      authorization: 'Bearer abc',
      nested: { accessToken: 'abc', apiKey: 'k' },
    });

    expect(JSON.stringify(lines)).not.toContain('abc');
    expect(lines[0]).toMatchObject({ authorization: '[REDACTED]' });
  });
});
