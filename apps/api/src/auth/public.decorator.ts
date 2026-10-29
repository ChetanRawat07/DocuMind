import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'documind:isPublic';

/**
 * Opts a route or controller out of authentication. Every route requires a
 * valid access token unless it carries this decorator, so a forgotten guard
 * fails closed.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
