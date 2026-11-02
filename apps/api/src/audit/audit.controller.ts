import {
  type AuditLogEntryDto,
  type AuditLogListResponse,
  type AuditLogQuery,
  auditLogQuerySchema,
  type DocumentActivityResponse,
} from '@documind/shared';
import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import type { User } from '../users/users.repository.js';
import { type AuditLogEntry, AuditLogsRepository } from './audit-logs.repository.js';

/** A document's activity shown on its page; older entries are on the Audit Logs screen. */
export const DOCUMENT_ACTIVITY_LIMIT = 50;

/**
 * Read access to the audit log. A user sees their own actions and the
 * system's actions on documents they own, never another user's entries.
 */
@Controller()
export class AuditController {
  constructor(
    private readonly auditLogs: AuditLogsRepository,
    private readonly documents: DocumentsRepository,
  ) {}

  @Get('audit-logs')
  async list(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQuery,
  ): Promise<AuditLogListResponse> {
    const page = await this.auditLogs.listForUser(user.id, {
      limit: query.limit,
      before: query.cursor,
    });
    return { items: page.entries.map(toAuditLogEntryDto), nextCursor: page.nextCursor };
  }

  /** The document's processing and review history, newest first. Same 404 for another user's document. */
  @Get('documents/:id/activity')
  async documentActivity(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DocumentActivityResponse> {
    if (!(await this.documents.findByIdForOwner(user.id, id))) {
      throw new NotFoundException('Document not found');
    }
    const entries = await this.auditLogs.listForResource('document', id, DOCUMENT_ACTIVITY_LIMIT);
    return { items: entries.map(toAuditLogEntryDto) };
  }
}

function toAuditLogEntryDto(entry: AuditLogEntry): AuditLogEntryDto {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    actor: entry.actor.type,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    requestId: entry.requestId,
    metadata: entry.metadata,
  };
}
