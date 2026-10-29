import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/app-config.js';
import { WorkerModule } from '../src/worker/worker.module.js';
import { WorkerService } from '../src/worker/worker.service.js';

describe('Worker application context', () => {
  it('boots without any HTTP layer and shuts down cleanly', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      WORKER_POLL_INTERVAL_MS: '60000',
      // The pool connects lazily and the skeleton worker never queries.
      DATABASE_URL: 'postgres://user:password@127.0.0.1:1/documind',
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    });
    // A compiled TestingModule is itself a Nest application context, like the one worker.ts creates.
    const app = await Test.createTestingModule({
      imports: [WorkerModule.register(config)],
    }).compile();
    await app.init();

    expect(app.get(WorkerService)).toBeInstanceOf(WorkerService);

    const startedAt = Date.now();
    await app.close();
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
