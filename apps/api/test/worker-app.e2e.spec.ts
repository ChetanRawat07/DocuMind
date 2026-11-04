import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config/app-config.js';
import { WorkerModule } from '../src/worker/worker.module.js';
import { WorkerService } from '../src/worker/worker.service.js';

const ENV = {
  NODE_ENV: 'test',
  WORKER_POLL_INTERVAL_MS: '60000',
  // Nothing listens on port 1: each poll fails fast and is logged, and shutdown must still be quick.
  DATABASE_URL: 'postgres://user:password@127.0.0.1:1/documind',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
};

describe('Worker application context', () => {
  it('boots without any HTTP layer and shuts down cleanly', async () => {
    const config = loadConfig(ENV);
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

  async function apiApp(workerInProcess: string) {
    const config = loadConfig({ ...ENV, WORKER_IN_PROCESS: workerInProcess });
    const app = await Test.createTestingModule({ imports: [AppModule.register(config)] }).compile();
    return app.init();
  }

  it('runs the poll loop inside the API process when WORKER_IN_PROCESS is set', async () => {
    const app = await apiApp('true');

    expect(app.get(WorkerService)).toBeInstanceOf(WorkerService);

    await app.close();
  });

  it('leaves the poll loop to the worker process by default', async () => {
    const app = await apiApp('false');

    expect(() => app.get(WorkerService)).toThrow();

    await app.close();
  });
});
