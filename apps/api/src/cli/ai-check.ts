import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { type DynamicModule, Module } from '@nestjs/common';
import { AiProviderError } from '../ai/ai-error.js';
import { AiModule } from '../ai/ai.module.js';
import { AiProvider } from '../ai/ai-provider.js';
import { generateStructured } from '../ai/generate-structured.js';
import { connectivityCheckPrompt } from '../ai/prompts/connectivity-check.js';
import { runEntrypoint } from '../common/bootstrap/run-entrypoint.js';
import { createLogger } from '../common/logging/create-logger.js';
import { type AppConfig, loadConfig } from '../config/app-config.js';
import { AppConfigModule } from '../config/app-config.module.js';

@Module({})
class AiCheckCliModule {
  static register(config: AppConfig): DynamicModule {
    return { module: AiCheckCliModule, imports: [AppConfigModule.forRoot(config), AiModule] };
  }
}

/**
 * `npm run ai:check`: one structured round trip through the configured
 * provider. Switching AI_PROVIDER (ollama locally, cloudflare in the demo)
 * changes nothing else. Prints provider, model, latency and token counts.
 */
runEntrypoint('ai-check', async () => {
  const config = loadConfig(process.env);
  const app = await NestFactory.createApplicationContext(AiCheckCliModule.register(config), {
    logger: createLogger(config, 'worker'),
  });
  try {
    const provider = app.get(AiProvider);
    const nonce = randomBytes(4).toString('hex');
    const { data, response, prompt } = await generateStructured(provider, connectivityCheckPrompt, {
      nonce,
    });
    const ok = data.echo === nonce;
    process.stdout.write(
      `${JSON.stringify({
        ok,
        provider: response.provider,
        model: response.model,
        prompt,
        durationMs: response.durationMs,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      })}\n`,
    );
    if (!ok) process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof AiProviderError)) throw error;
    process.stderr.write(
      `AI check failed (${error.kind}, ${error.retryable ? 'retryable' : 'permanent'}): ${error.message}\n`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
});
