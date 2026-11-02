import { Module } from '@nestjs/common';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import { AiProvider } from './ai-provider.js';
import { CloudflareProvider } from './cloudflare-provider.js';
import { OllamaProvider } from './ollama-provider.js';

/** Provides AiProvider, backed by the provider chosen in configuration. */
@Module({
  providers: [
    {
      provide: AiProvider,
      inject: [APP_CONFIG],
      useFactory: ({ ai }: AppConfig): AiProvider =>
        ai.provider === 'ollama' ? new OllamaProvider(ai) : new CloudflareProvider(ai),
    },
  ],
  exports: [AiProvider],
})
export class AiModule {}
