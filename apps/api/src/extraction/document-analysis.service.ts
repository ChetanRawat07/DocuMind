import type { DocumentType } from '@documind/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiProvider } from '../ai/ai-provider.js';
import { generateStructured } from '../ai/generate-structured.js';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import type { JsonArray, JsonObject } from '../database/generated/database.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import { canSkipReview } from '../review/review-fields.js';
import { DocumentTextsRepository } from '../text-extraction/document-texts.repository.js';
import { TextExtractionService } from '../text-extraction/text-extraction.service.js';
import type { ExtractedPage } from '../text-extraction/text-extractor.js';
import { type Assessment, assessExtraction, CONFIDENCE } from './assess-extraction.js';
import {
  DocumentExtractionsRepository,
  type InsertExtractionResult,
} from './document-extractions.repository.js';
import {
  classifyDocumentPrompt,
  EXTRACTION_PROMPTS,
  EXTRACTION_TEXT_LIMIT,
  UNSUPPORTED_TYPE,
} from './extraction-prompts.js';
import { EXTRACTION_SCHEMAS } from './extraction-schemas.js';
import { locateEvidence } from './evidence.js';
import {
  fieldsWithoutVisibleEvidence,
  MAX_RENDERED_EVIDENCE_PAGES,
  textLayerEvidencePages,
} from './visible-evidence.js';

/** PostgreSQL foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

export type DocumentAnalysisFailure = 'text_not_extracted' | 'no_text';

/**
 * The document cannot be analyzed yet (`text_not_extracted`: run text
 * extraction first, so a retry after it can succeed) or ever (`no_text`).
 */
export class DocumentAnalysisError extends Error {
  readonly permanent: boolean;

  constructor(readonly failure: DocumentAnalysisFailure) {
    super(
      failure === 'no_text'
        ? 'The document contains no text'
        : 'The document has no extracted text',
    );
    this.name = 'DocumentAnalysisError';
    this.permanent = failure === 'no_text';
  }
}

interface AnalysisBase {
  readonly documentId: string;
  readonly classificationConfidence: number;
  readonly classificationPrompt: string;
  readonly aiProvider: string;
  readonly aiModel: string;
}

/** A supported type was found and its fields extracted, validated and scored. */
export interface ExtractedAnalysis extends AnalysisBase, Assessment {
  readonly outcome: 'extracted';
  readonly documentType: DocumentType;
  readonly schemaVersion: number;
  readonly extractionPrompt: string;
}

/** Not an invoice, purchase order or contract: nothing to extract. */
export interface UnsupportedAnalysis extends AnalysisBase {
  readonly outcome: 'unsupported';
}

export type DocumentAnalysis = ExtractedAnalysis | UnsupportedAnalysis;

/**
 * Classifies a document from its extracted text, extracts the fields of its
 * type and scores them. `analyze` only reads; `save` stores a result for the
 * processing job that produced it. The worker runs both;
 * `npm run analyze -- <documentId>` runs `analyze` by hand for development.
 *
 * AI failures surface as AiProviderError. Model output that fails the
 * schema is one of them (`invalid_output`), so it never reaches `save`.
 */
@Injectable()
export class DocumentAnalysisService {
  private readonly logger = new Logger(DocumentAnalysisService.name);

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseExecutor,
    private readonly documents: DocumentsRepository,
    private readonly texts: DocumentTextsRepository,
    private readonly extractions: DocumentExtractionsRepository,
    private readonly auditLogs: AuditLogsRepository,
    private readonly ai: AiProvider,
    private readonly textExtraction: TextExtractionService,
  ) {}

  /** Returns null when the document does not exist. */
  async analyze(
    documentId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<DocumentAnalysis | null> {
    const document = await this.documents.findByIdForProcessing(documentId);
    if (!document) return null;
    const documentText = await this.texts.findForDocument(documentId);
    if (!documentText) throw new DocumentAnalysisError('text_not_extracted');
    const text = documentText.pages.map((page) => page.text).join('\n\n');
    if (text.trim() === '') throw new DocumentAnalysisError('no_text');

    const classification = await generateStructured(
      this.ai,
      classifyDocumentPrompt,
      { text },
      options,
    );
    const { documentType, evidence } = classification.data;
    const base: AnalysisBase = {
      documentId,
      classificationConfidence:
        evidence !== null && locateEvidence(documentText.pages, evidence)
          ? CONFIDENCE.classificationGrounded
          : CONFIDENCE.classificationUngrounded,
      classificationPrompt: classification.prompt,
      aiProvider: classification.response.provider,
      aiModel: classification.response.model,
    };
    if (documentType === UNSUPPORTED_TYPE) return { ...base, outcome: 'unsupported' };

    const extraction = await generateStructured(
      this.ai,
      EXTRACTION_PROMPTS[documentType],
      { text },
      options,
    );
    return {
      ...base,
      outcome: 'extracted',
      documentType,
      schemaVersion: EXTRACTION_SCHEMAS[documentType].version,
      extractionPrompt: extraction.prompt,
      ...(await this.confirmVisibleEvidence(
        documentId,
        documentType,
        assessExtraction({
          documentType,
          extraction: extraction.data,
          pages: documentText.pages,
          classificationConfidence: base.classificationConfidence,
          textTruncated: text.length > EXTRACTION_TEXT_LIMIT,
        }),
        documentText.pages,
      )),
    };
  }

  /**
   * An extraction that would complete without review must be grounded in
   * what a reader sees. Text-layer pages holding its evidence are rendered and
   * read with OCR; values whose evidence is not there get an
   * `evidence_not_visible` issue, which sends the document to review.
   * Extractions going to review anyway are not checked: a person sees the
   * file. Values are never changed, only flagged.
   */
  private async confirmVisibleEvidence(
    documentId: string,
    documentType: DocumentType,
    assessment: Assessment,
    pages: readonly ExtractedPage[],
  ): Promise<Assessment> {
    if (!canSkipReview(assessment)) return assessment;
    const pageNumbers = textLayerEvidencePages(documentType, assessment.fields, pages);
    if (pageNumbers.length === 0) return assessment;

    // OCR pages are already read from the rendered image.
    const visible = pages.filter((page) => page.method === 'ocr');
    if (pageNumbers.length <= MAX_RENDERED_EVIDENCE_PAGES) {
      try {
        visible.push(
          ...((await this.textExtraction.readRenderedPages(documentId, pageNumbers)) ?? []),
        );
      } catch (error) {
        // Unconfirmed evidence means review, never a failed job.
        this.logger.warn(
          `Could not render pages to confirm evidence: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
    const fields = fieldsWithoutVisibleEvidence(documentType, assessment.fields, visible);
    if (fields.length === 0) return assessment;
    return {
      ...assessment,
      issues: [...assessment.issues, { code: 'evidence_not_visible', fields }],
    };
  }

  /**
   * Stores the result for the job that produced it and records the
   * document's type, in one transaction. Idempotent per job: a retried save
   * returns the stored extraction. Returns null when the document or job
   * was deleted meanwhile.
   *
   * Pass `executor` to save inside the caller's transaction, so the result
   * commits or rolls back with the caller's other writes (the worker finishes
   * the job in it). Foreign-key errors then propagate to the caller.
   */
  async save(
    jobId: string,
    analysis: ExtractedAnalysis,
    executor?: DatabaseExecutor,
  ): Promise<InsertExtractionResult | null> {
    if (executor) return this.insert(jobId, analysis, executor);
    try {
      return await this.db.transaction().execute((trx) => this.insert(jobId, analysis, trx));
    } catch (error) {
      if ((error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION) return null;
      throw error;
    }
  }

  private async insert(
    jobId: string,
    analysis: ExtractedAnalysis,
    trx: DatabaseExecutor,
  ): Promise<InsertExtractionResult> {
    const result = await this.extractions.insertOnce(
      {
        documentId: analysis.documentId,
        jobId,
        documentType: analysis.documentType,
        schemaVersion: analysis.schemaVersion,
        // Plain JSON by construction: strings, numbers, nulls and arrays of them.
        fields: analysis.fields as unknown as JsonObject,
        overallConfidence: analysis.overallConfidence,
        classificationConfidence: analysis.classificationConfidence,
        validationIssues: analysis.issues as unknown as JsonArray,
        aiProvider: analysis.aiProvider,
        aiModel: analysis.aiModel,
        classificationPrompt: analysis.classificationPrompt,
        extractionPrompt: analysis.extractionPrompt,
      },
      trx,
    );
    if (!result.created) return result;

    await this.documents.setDocumentType(analysis.documentId, analysis.documentType, trx);
    await this.auditLogs.append(
      {
        actor: { type: 'system' },
        action: 'document.fields_extracted',
        resourceType: 'document',
        resourceId: analysis.documentId,
        // Scores and issue codes only: audit entries never hold document content.
        metadata: {
          jobId,
          documentType: analysis.documentType,
          schemaVersion: analysis.schemaVersion,
          overallConfidence: analysis.overallConfidence,
          issues: analysis.issues.map((issue) => issue.code),
          aiProvider: analysis.aiProvider,
          aiModel: analysis.aiModel,
        },
      },
      trx,
    );
    return result;
  }
}
