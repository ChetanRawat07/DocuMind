import type { DocumentType } from '@documind/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import type { DocumentExtractions, JsonArray, JsonObject } from '../database/generated/database.js';

export interface DocumentExtraction {
  readonly id: string;
  readonly documentId: string;
  readonly jobId: string;
  readonly documentType: DocumentType;
  readonly schemaVersion: number;
  /** Field-level values and confidences; validated against the extraction schema before insert. */
  readonly fields: JsonObject;
  readonly overallConfidence: number;
  readonly classificationConfidence: number;
  /** Business-rule and evidence findings: codes and field names, never values. */
  readonly validationIssues: JsonArray;
  readonly aiProvider: string;
  readonly aiModel: string;
  /** `template-id@version` of each prompt that produced the result. */
  readonly classificationPrompt: string;
  readonly extractionPrompt: string;
  readonly createdAt: Date;
}

export type NewDocumentExtraction = Omit<DocumentExtraction, 'id' | 'createdAt'>;

export interface InsertExtractionResult {
  readonly extraction: DocumentExtraction;
  /** false when this job had already stored its extraction (a retried persist step). */
  readonly created: boolean;
}

@Injectable()
export class DocumentExtractionsRepository {
  constructor(@Inject(DATABASE) private readonly db: DatabaseExecutor) {}

  /**
   * Stores a job's extraction exactly once. If the worker crashes after the
   * insert but before marking the job done, the retry hits the unique job_id
   * and gets the stored extraction back instead of creating a second one.
   */
  async insertOnce(
    extraction: NewDocumentExtraction,
    executor = this.db,
  ): Promise<InsertExtractionResult> {
    const inserted = await executor
      .insertInto('document_extractions')
      .values({
        document_id: extraction.documentId,
        job_id: extraction.jobId,
        document_type: extraction.documentType,
        schema_version: extraction.schemaVersion,
        // Serialized explicitly: node-postgres would turn a top-level array
        // into a Postgres array instead of JSON.
        fields: JSON.stringify(extraction.fields),
        overall_confidence: extraction.overallConfidence,
        classification_confidence: extraction.classificationConfidence,
        validation_issues: JSON.stringify(extraction.validationIssues),
        ai_provider: extraction.aiProvider,
        ai_model: extraction.aiModel,
        classification_prompt: extraction.classificationPrompt,
        extraction_prompt: extraction.extractionPrompt,
      })
      .onConflict((conflict) => conflict.column('job_id').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) {
      return { extraction: toExtraction(inserted), created: true };
    }

    const existing = await executor
      .selectFrom('document_extractions')
      .selectAll()
      .where('job_id', '=', extraction.jobId)
      .executeTakeFirstOrThrow();
    return { extraction: toExtraction(existing), created: false };
  }

  async findLatestForDocument(
    documentId: string,
    executor = this.db,
  ): Promise<DocumentExtraction | null> {
    const row = await executor
      .selectFrom('document_extractions')
      .selectAll()
      .where('document_id', '=', documentId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? toExtraction(row) : null;
  }
}

function toExtraction(row: Selectable<DocumentExtractions>): DocumentExtraction {
  return {
    id: row.id,
    documentId: row.document_id,
    jobId: row.job_id,
    // CHECK constraints guarantee the type value and the JSON object and array shapes.
    documentType: row.document_type as DocumentType,
    schemaVersion: row.schema_version,
    fields: row.fields as JsonObject,
    overallConfidence: row.overall_confidence,
    classificationConfidence: row.classification_confidence,
    validationIssues: row.validation_issues as JsonArray,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    classificationPrompt: row.classification_prompt,
    extractionPrompt: row.extraction_prompt,
    createdAt: row.created_at,
  };
}
