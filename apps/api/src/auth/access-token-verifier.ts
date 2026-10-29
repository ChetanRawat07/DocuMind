import { Inject, Injectable } from '@nestjs/common';
import { errors, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { z } from 'zod';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import type { UserIdentity } from '../users/users.repository.js';

/** Resolves the public key for a token header: the remote JWKS in production, a local set in tests. */
export const JWT_KEY_RESOLVER = Symbol('JWT_KEY_RESOLVER');

/**
 * Asymmetric algorithms Supabase signs with. Pinning the list blocks algorithm
 * confusion: `none` and HS256 tokens are rejected before any key is looked up.
 */
export const ACCEPTED_ALGORITHMS = ['ES256', 'RS256'];

/** Supabase sets `aud` to "authenticated" for signed-in users. */
const AUDIENCE = 'authenticated';

/** Absorbs small clock differences between Supabase and this server. */
const CLOCK_TOLERANCE_SECONDS = 5;

/** Real access tokens are around 1 KB; anything far larger is rejected before parsing. */
export const MAX_ACCESS_TOKEN_LENGTH = 8192;

const claimsSchema = z.object({
  sub: z.uuid(),
  role: z.literal('authenticated'),
  email: z.string().min(3).max(320),
  is_anonymous: z.boolean().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Failures that mean "this token is not acceptable", as opposed to "keys could not be fetched". */
const TOKEN_ERRORS = [
  errors.JWTClaimValidationFailed,
  errors.JWSInvalid,
  errors.JWTInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
];

export class InvalidAccessTokenError extends Error {
  constructor(
    readonly reason: 'expired' | 'invalid',
    options?: ErrorOptions,
  ) {
    super(reason === 'expired' ? 'Access token expired' : 'Invalid access token', options);
    this.name = 'InvalidAccessTokenError';
  }
}

/**
 * The signing keys could not be fetched (Supabase unreachable, timeout, bad
 * JWKS response). Distinct from an invalid token so clients see a retryable
 * 503 instead of a 401 that would sign the user out.
 */
export class AuthProviderUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Authentication provider unavailable', options);
    this.name = 'AuthProviderUnavailableError';
  }
}

/**
 * Verifies Supabase access tokens locally: signature against the project's
 * public keys, then issuer, audience, expiry and required claims. No call to
 * Supabase per request; keys are cached by the resolver.
 */
@Injectable()
export class AccessTokenVerifier {
  private readonly issuer: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(JWT_KEY_RESOLVER) private readonly keys: JWTVerifyGetKey,
  ) {
    this.issuer = config.auth.issuer;
  }

  async verify(token: string): Promise<UserIdentity> {
    if (token.length > MAX_ACCESS_TOKEN_LENGTH) {
      throw new InvalidAccessTokenError('invalid');
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: AUDIENCE,
        algorithms: ACCEPTED_ALGORITHMS,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new InvalidAccessTokenError('expired', { cause: error });
      }
      if (TOKEN_ERRORS.some((tokenError) => error instanceof tokenError)) {
        throw new InvalidAccessTokenError('invalid', { cause: error });
      }
      throw new AuthProviderUnavailableError({ cause: error });
    }

    // A validly signed token can still be one this API does not accept:
    // anonymous sessions, service-role keys, or accounts without an email.
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success || claims.data.is_anonymous === true) {
      throw new InvalidAccessTokenError('invalid');
    }

    return {
      id: claims.data.sub,
      email: claims.data.email,
      displayName: displayNameFrom(claims.data.user_metadata),
    };
  }
}

/**
 * user_metadata is editable by the user, so it is only trusted as a display
 * label, and only when it fits the users.display_name constraint.
 */
function displayNameFrom(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.display_name;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 100 ? trimmed : null;
}
