import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRemoteJWKSet, errors, SignJWT, UnsecuredJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  generateForeignKey,
  TEST_ISSUER,
  TEST_SUPABASE_URL,
  TestTokenIssuer,
} from '../../test/support/test-auth.js';
import { type AppConfig, loadConfig } from '../config/app-config.js';
import {
  AccessTokenVerifier,
  AuthProviderUnavailableError,
  InvalidAccessTokenError,
  MAX_ACCESS_TOKEN_LENGTH,
} from './access-token-verifier.js';

const config: AppConfig = loadConfig({
  DATABASE_URL: 'postgres://user:password@127.0.0.1:1/documind',
  SUPABASE_URL: TEST_SUPABASE_URL,
});

async function expectRejected(
  promise: Promise<unknown>,
  reason: 'expired' | 'invalid' = 'invalid',
): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(InvalidAccessTokenError);
  expect((error as InvalidAccessTokenError).reason).toBe(reason);
}

describe('AccessTokenVerifier', () => {
  let issuer: TestTokenIssuer;
  let verifier: AccessTokenVerifier;
  const userId = randomUUID();

  beforeAll(async () => {
    issuer = await TestTokenIssuer.create();
    verifier = new AccessTokenVerifier(config, issuer.keyResolver);
  });

  it('returns the identity from a valid Supabase access token', async () => {
    const token = await issuer.sign(userId, {
      claims: { email: 'ada@example.test', user_metadata: { display_name: '  Ada  ' } },
    });

    await expect(verifier.verify(token)).resolves.toEqual({
      id: userId,
      email: 'ada@example.test',
      displayName: 'Ada',
    });
  });

  it.each([
    ['missing', undefined],
    ['not a string', 42],
    ['empty after trimming', '   '],
    ['longer than the column allows', 'x'.repeat(101)],
  ])('ignores a display name that is %s', async (_case, displayName) => {
    const token = await issuer.sign(userId, {
      claims: { user_metadata: { display_name: displayName } },
    });

    expect((await verifier.verify(token)).displayName).toBeNull();
  });

  it('reports an expired token as expired', async () => {
    await expectRejected(verifier.verify(await issuer.sign(userId, { expiresIn: -60 })), 'expired');
  });

  it('tolerates a few seconds of clock skew', async () => {
    const token = await issuer.sign(userId, { expiresIn: -2 });

    await expect(verifier.verify(token)).resolves.toMatchObject({ id: userId });
  });

  it.each([
    ['another issuer', { iss: 'https://evil.supabase.co/auth/v1' }],
    ['the anon audience', { aud: 'anon' }],
    ['the service_role role', { role: 'service_role' }],
    ['the anon role', { role: 'anon' }],
    ['an anonymous user', { is_anonymous: true }],
    ['no email', { email: undefined }],
    ['an empty email (phone sign-in)', { email: '' }],
    ['a non-UUID subject', { sub: 'admin' }],
    ['no subject', { sub: undefined }],
    ['no issued-at time', { iat: undefined }],
    ['a not-before time in the future', { nbf: Math.floor(Date.now() / 1000) + 3600 }],
  ])('rejects a token with %s', async (_case, claims) => {
    await expectRejected(verifier.verify(await issuer.sign(userId, { claims })));
  });

  it('rejects a token without an expiry', async () => {
    const token = await issuer.sign(userId, { claims: { exp: undefined } });

    await expectRejected(verifier.verify(token));
  });

  it('rejects a token signed by a key outside the JWKS', async () => {
    const token = await issuer.sign(userId, { key: await generateForeignKey() });

    await expectRejected(verifier.verify(token));
  });

  it('rejects a token whose key id is unknown', async () => {
    const token = await issuer.sign(userId, {
      kid: 'unknown-key',
      key: await generateForeignKey(),
    });

    await expectRejected(verifier.verify(token));
  });

  it('rejects a token whose payload was altered after signing', async () => {
    const [header, , signature] = (await issuer.sign(userId)).split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: randomUUID(), role: 'authenticated' }),
    ).toString('base64url');

    await expectRejected(verifier.verify(`${header}.${forgedPayload}.${signature}`));
  });

  it('rejects an unsigned token (alg "none")', async () => {
    const token = new UnsecuredJWT({ sub: userId, role: 'authenticated', email: 'a@b.test' })
      .setIssuer(TEST_ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .encode();

    await expectRejected(verifier.verify(token));
  });

  it('rejects an HS256 token, closing the algorithm-confusion attack', async () => {
    const token = await new SignJWT({ sub: userId, role: 'authenticated', email: 'a@b.test' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(TEST_ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-shared-secret-an-attacker-guessed'));

    await expectRejected(verifier.verify(token));
  });

  it('rejects a validly signed token whose algorithm is not on the allowlist', async () => {
    const ps256 = await TestTokenIssuer.create('PS256');
    const strict = new AccessTokenVerifier(config, ps256.keyResolver);

    await expectRejected(strict.verify(await ps256.sign(userId)));
  });

  it('accepts RS256, which Supabase also supports', async () => {
    const rs256 = await TestTokenIssuer.create('RS256');
    const verifierForRs256 = new AccessTokenVerifier(config, rs256.keyResolver);

    await expect(verifierForRs256.verify(await rs256.sign(userId))).resolves.toMatchObject({
      id: userId,
    });
  });

  it.each(['', 'not-a-jwt', 'a.b.c', 'x'.repeat(MAX_ACCESS_TOKEN_LENGTH + 1)])(
    'rejects malformed token %#',
    async (token) => {
      await expectRejected(verifier.verify(token));
    },
  );

  it('reports a key-fetch timeout as the provider being unavailable', async () => {
    const timingOut = new AccessTokenVerifier(config, () => {
      throw new errors.JWKSTimeout();
    });

    await expect(timingOut.verify(await issuer.sign(userId))).rejects.toBeInstanceOf(
      AuthProviderUnavailableError,
    );
  });

  it('reports a network failure as the provider being unavailable', async () => {
    const offline = new AccessTokenVerifier(config, () => {
      throw new TypeError('fetch failed');
    });

    await expect(offline.verify(await issuer.sign(userId))).rejects.toBeInstanceOf(
      AuthProviderUnavailableError,
    );
  });
});

/** Exercises jose's real remote JWKS client against a local HTTP server. */
describe('AccessTokenVerifier with a remote JWKS', () => {
  let server: Server;
  let jwksUrl: URL;
  let respondWith: { status: number; body: string };

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(respondWith.status, { 'content-type': 'application/json' });
      response.end(respondWith.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    jwksUrl = new URL(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/v1/.well-known/jwks.json`,
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it('verifies tokens with keys fetched from the JWKS endpoint', async () => {
    const issuer = await TestTokenIssuer.create();
    respondWith = { status: 200, body: JSON.stringify(issuer.jwks) };
    const verifier = new AccessTokenVerifier(config, createRemoteJWKSet(jwksUrl));
    const userId = randomUUID();

    await expect(verifier.verify(await issuer.sign(userId))).resolves.toMatchObject({ id: userId });
  });

  it('reports a failing JWKS endpoint as unavailable, not as an invalid token', async () => {
    respondWith = { status: 500, body: '{}' };
    const issuer = await TestTokenIssuer.create();
    const verifier = new AccessTokenVerifier(config, createRemoteJWKSet(jwksUrl));

    await expect(verifier.verify(await issuer.sign(randomUUID()))).rejects.toBeInstanceOf(
      AuthProviderUnavailableError,
    );
  });

  it('reports an unreachable JWKS endpoint as unavailable', async () => {
    const issuer = await TestTokenIssuer.create();
    const verifier = new AccessTokenVerifier(
      config,
      createRemoteJWKSet(new URL('http://127.0.0.1:1/auth/v1/.well-known/jwks.json')),
    );

    await expect(verifier.verify(await issuer.sign(randomUUID()))).rejects.toBeInstanceOf(
      AuthProviderUnavailableError,
    );
  });
});
