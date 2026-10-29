import { Inject, Injectable } from '@nestjs/common';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { type User, type UserIdentity, UsersRepository } from '../users/users.repository.js';

/**
 * Maps a verified identity to the local users row: created on first sight,
 * profile synced when Supabase reports a different email or display name.
 * The common case (nothing changed) is a single primary-key read, no write.
 */
@Injectable()
export class UserProvisioningService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseExecutor,
    private readonly users: UsersRepository,
    private readonly auditLogs: AuditLogsRepository,
  ) {}

  async resolve(identity: UserIdentity): Promise<User> {
    const existing = await this.users.findById(identity.id);
    if (existing) {
      return hasSameProfile(existing, identity) ? existing : this.syncProfile(identity);
    }

    const created = await this.db.transaction().execute(async (trx) => {
      const user = await this.users.createIfAbsent(identity, trx);
      if (user) {
        await this.auditLogs.append(
          {
            actor: { type: 'user', userId: user.id },
            action: 'user.registered',
            resourceType: 'user',
            resourceId: user.id,
            requestId: null,
            metadata: {},
          },
          trx,
        );
      }
      return user;
    });

    // null: a concurrent request created the row first. It is committed by
    // now (ON CONFLICT waited for it), so sync against it.
    return created ?? this.syncProfile(identity);
  }

  private async syncProfile(identity: UserIdentity): Promise<User> {
    const user = await this.users.updateProfile(identity);
    if (!user) {
      // Only possible if the row was deleted between two statements of this request.
      throw new Error('User disappeared while being provisioned');
    }
    return user;
  }
}

function hasSameProfile(user: User, identity: UserIdentity): boolean {
  return user.email === identity.email && user.displayName === identity.displayName;
}
