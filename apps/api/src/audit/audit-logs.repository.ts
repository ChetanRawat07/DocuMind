import { MAX_AUDIT_LOG_PAGE_SIZE } from '@documind/shared';
import { Inject, Injectable } from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { currentCorrelation } from '../common/correlation/correlation.js';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import type { AuditLogs, JsonObject } from '../database/generated/database.js';

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
  /** Defaults to the current request's id (or the id of the request that queued the job). */
  readonly requestId?: string | null;
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
        request_id:
          entry.requestId === undefined
            ? (currentCorrelation().requestId ?? null)
            : entry.requestId,
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
    assertPageSize(limit);
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

  /**
   * What a user may see, newest first: their own actions, and the system's
   * actions on documents they still own. Paged by id (identity values
   * increase with insertion); `before` is the last id of the previous page.
   *
   * Each half is limited on its own index before the merge: the user's
   * entries through `audit_logs_actor_user_id_id_idx`, the system's through
   * the per-document resource index. System entries about a deleted document
   * are no longer visible; the user's own entries about it are.
   */
  async listForUser(
    userId: string,
    options: { readonly limit: number; readonly before?: string | undefined },
    executor = this.db,
  ): Promise<{ entries: AuditLogEntry[]; nextCursor: string | null }> {
    assertPageSize(options.limit);
    // One extra row tells whether another page exists.
    const fetch = options.limit + 1;
    const before = options.before === undefined ? sql`` : sql`AND a.id < ${options.before}`;
    const result = await sql<Selectable<AuditLogs>>`
      SELECT * FROM (
        (SELECT a.* FROM audit_logs a
         WHERE a.actor_user_id = ${userId} ${before}
         ORDER BY a.id DESC LIMIT ${fetch})
        UNION ALL
        (SELECT a.* FROM audit_logs a
         JOIN documents d ON d.id = a.resource_id
         WHERE a.resource_type = 'document' AND a.actor_type = 'system'
           AND d.user_id = ${userId} ${before}
         ORDER BY a.id DESC LIMIT ${fetch})
      ) entries
      ORDER BY id DESC
      LIMIT ${fetch}
    `.execute(executor);
    const entries = result.rows.slice(0, options.limit).map(toAuditLogEntry);
    return {
      entries,
      nextCursor: result.rows.length > options.limit ? (entries.at(-1)?.id ?? null) : null,
    };
  }
}

function assertPageSize(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AUDIT_LOG_PAGE_SIZE) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_AUDIT_LOG_PAGE_SIZE}`);
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
