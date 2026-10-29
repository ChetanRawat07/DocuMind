import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import type { AuditLogs, JsonObject } from '../database/generated/database.js';

export const MAX_AUDIT_LOG_PAGE_SIZE = 100;

export type AuditActor =
  { readonly type: 'user'; readonly userId: string } | { readonly type: 'system' };

export interface AuditLogEntry {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actor: AuditActor;
  /** `<resource>.<verb>`, for example `document.uploaded`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly requestId: string | null;
  readonly metadata: JsonObject;
}

export interface NewAuditLogEntry {
  readonly actor: AuditActor;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly requestId: string | null;
  /** Context for the entry. Must never contain secrets, tokens or document content. */
  readonly metadata: JsonObject;
}

/** Append-only: the table rejects UPDATE, and this repository offers no way to change an entry. */
@Injectable()
export class AuditLogsRepository {
  constructor(@Inject(DATABASE) private readonly db: DatabaseExecutor) {}

  async append(entry: NewAuditLogEntry, executor = this.db): Promise<AuditLogEntry> {
    const row = await executor
      .insertInto('audit_logs')
      .values({
        actor_type: entry.actor.type,
        actor_user_id: entry.actor.type === 'user' ? entry.actor.userId : null,
        action: entry.action,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId,
        request_id: entry.requestId,
        metadata: JSON.stringify(entry.metadata),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toAuditLogEntry(row);
  }

  /** Most recent entries for one resource, newest first. */
  async listForResource(
    resourceType: string,
    resourceId: string,
    limit: number,
    executor = this.db,
  ): Promise<AuditLogEntry[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AUDIT_LOG_PAGE_SIZE) {
      throw new RangeError(`limit must be an integer between 1 and ${MAX_AUDIT_LOG_PAGE_SIZE}`);
    }
    const rows = await executor
      .selectFrom('audit_logs')
      .selectAll()
      .where('resource_type', '=', resourceType)
      .where('resource_id', '=', resourceId)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toAuditLogEntry);
  }
}

function toAuditLogEntry(row: Selectable<AuditLogs>): AuditLogEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    // The table's CHECK guarantees actor_user_id is set exactly when actor_type is 'user'.
    actor:
      row.actor_type === 'user' && row.actor_user_id !== null
        ? { type: 'user', userId: row.actor_user_id }
        : { type: 'system' },
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    requestId: row.request_id,
    metadata: row.metadata as JsonObject,
  };
}
