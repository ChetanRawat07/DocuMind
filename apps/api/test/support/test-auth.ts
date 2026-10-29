import { randomUUID } from 'node:crypto';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';

/** Matches SUPABASE_URL in test configs; the verifier derives the issuer from it. */
export const TEST_SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
export const TEST_ISSUER = `${TEST_SUPABASE_URL}/auth/v1`;

/** Derived from jose so it does not depend on a global CryptoKey declaration. */
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

export interface TestTokenOptions {
  /** Claims merged over valid Supabase defaults; `undefined` removes a claim. */
  readonly claims?: Record<string, unknown>;
  /** Seconds from now; negative for an already expired token. */
  readonly expiresIn?: number;
  readonly key?: SigningKey;
  readonly kid?: string;
}

/**
 * Stand-in for a Supabase project's signing keys: an ES256 key pair whose
 * public half is served through a local JWKS. Tests sign real tokens with it,
 * so the production verification path runs unchanged and offline.
 */
export class TestTokenIssuer {
  private constructor(
    /** Public keys, as a Supabase JWKS endpoint would serve them. */
    readonly jwks: JSONWebKeySet,
    readonly keyResolver: JWTVerifyGetKey,
    private readonly privateKey: SigningKey,
    private readonly kid: string,
    private readonly algorithm: string,
  ) {}

  /** ES256 is what Supabase uses; other algorithms exist to test the allowlist. */
  static async create(algorithm = 'ES256'): Promise<TestTokenIssuer> {
    const { publicKey, privateKey } = await generateKeyPair(algorithm);
    const kid = randomUUID();
    const jwk = { ...(await exportJWK(publicKey)), kid, alg: algorithm, use: 'sig' };
    const jwks = { keys: [jwk] };
    return new TestTokenIssuer(jwks, createLocalJWKSet(jwks), privateKey, kid, algorithm);
  }

  /** A token Supabase would issue for a signed-in user, unless options say otherwise. */
  async sign(userId: string, options: TestTokenOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: JWTPayload = {
      iss: TEST_ISSUER,
      aud: 'authenticated',
      sub: userId,
      role: 'authenticated',
      email: `user-${userId}@example.test`,
      is_anonymous: false,
      aal: 'aal1',
      session_id: randomUUID(),
      iat: now,
      exp: now + (options.expiresIn ?? 3600),
      ...options.claims,
    };
    const definedClaims = Object.fromEntries(
      Object.entries(claims).filter(([, value]) => value !== undefined),
    );
    return new SignJWT(definedClaims)
      .setProtectedHeader({ alg: this.algorithm, kid: options.kid ?? this.kid, typ: 'JWT' })
      .sign(options.key ?? this.privateKey);
  }
}

/** A key the test JWKS does not contain, for "signed by someone else" cases. */
export async function generateForeignKey(): Promise<SigningKey> {
  return (await generateKeyPair('ES256')).privateKey;
}
