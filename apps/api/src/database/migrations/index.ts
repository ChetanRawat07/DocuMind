import type { Migration } from 'kysely/migration';
import * as initialSchema from './20261029120000_initial_schema.js';
import * as usersEmailNotUnique from './20261029140000_users_email_not_unique.js';
import * as documentTexts from './20261030120000_document_texts.js';
import * as extractionDetails from './20261102120000_extraction_details.js';
import * as extractionReviews from './20261102150000_extraction_reviews.js';
import * as observability from './20261103120000_observability.js';

/**
 * Explicit migration registry. Kysely runs migrations in key order, so keys
 * start with a UTC timestamp. Listing them here (instead of scanning a folder
 * at runtime) works identically in the compiled build and in tests; a test
 * fails if a migration file exists that is not registered.
 */
export const migrations: Record<string, Migration> = {
  '20261029120000_initial_schema': initialSchema,
  '20261029140000_users_email_not_unique': usersEmailNotUnique,
  '20261030120000_document_texts': documentTexts,
  '20261102120000_extraction_details': extractionDetails,
  '20261102150000_extraction_reviews': extractionReviews,
  '20261103120000_observability': observability,
};
