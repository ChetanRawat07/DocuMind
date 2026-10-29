import { expect } from 'vitest';

/** SQLSTATE codes asserted on in tests. */
export const PG = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  notNullViolation: '23502',
  restrictViolation: '23001',
  invalidTextRepresentation: '22P02',
} as const;

/** Asserts the operation fails with the given SQLSTATE (and constraint, when given). */
export async function expectPgError(
  operation: Promise<unknown>,
  expected: { code: string; constraint?: string },
): Promise<void> {
  const error: unknown = await operation.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, 'expected the database to reject the operation').not.toBeNull();
  expect(error).toMatchObject(expected);
}
