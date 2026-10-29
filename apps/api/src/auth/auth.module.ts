import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { AuditModule } from '../audit/audit.module.js';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccessTokenVerifier, JWT_KEY_RESOLVER } from './access-token-verifier.js';
import { AuthGuard } from './auth.guard.js';
import { UserProvisioningService } from './user-provisioning.service.js';

/**
 * HTTP authentication. Imported by the API process only; the worker has no
 * HTTP surface and acts as the system, not as a user.
 */
@Module({
  imports: [UsersModule, AuditModule],
  providers: [
    {
      provide: JWT_KEY_RESOLVER,
      inject: [APP_CONFIG],
      // Keys are cached in memory. An unknown key id triggers a refetch (at
      // most once per cooldown), so Supabase key rotation needs no restart.
      useFactory: (config: AppConfig) =>
        createRemoteJWKSet(config.auth.jwksUrl, {
          timeoutDuration: 5_000,
          cooldownDuration: 30_000,
          cacheMaxAge: 10 * 60_000,
        }),
    },
    AccessTokenVerifier,
    UserProvisioningService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
