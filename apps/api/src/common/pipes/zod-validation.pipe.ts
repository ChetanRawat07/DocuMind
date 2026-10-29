import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates and parses request input with a shared Zod schema, so the API and
 * the web client agree on one definition. Failures are 400s naming the field.
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`),
      );
    }
    return result.data;
  }
}
