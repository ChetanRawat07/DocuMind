import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProviderError } from './ai-error.js';
import type { AiProvider, AiRequest } from './ai-provider.js';
import { CloudflareProvider } from './cloudflare-provider.js';
import { OLLAMA_CONTEXT_TOKENS, OllamaProvider } from './ollama-provider.js';

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const REQUEST: AiRequest = {
  system: 'You are a test.',
  user: 'Say ok.',
  jsonSchema: SCHEMA,
  maxOutputTokens: 50,
  temperature: 0,
};
const TOKEN = 'cf-secret-token';

const ollama = (timeoutMs = 5000) =>
  new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'qwen2.5:3b', timeoutMs });
const cloudflare = (timeoutMs = 5000) =>
  new CloudflareProvider({
    accountId: '0123456789abcdef0123456789abcdef',
    apiToken: TOKEN,
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    timeoutMs,
  });

const OK_BODY = {
  ollama: {
    message: { content: '{"ok":true}' },
    done_reason: 'stop',
    prompt_eval_count: 12,
    eval_count: 5,
  },
  cloudflare: {
    success: true,
    result: { response: '{"ok":true}', usage: { prompt_tokens: 12, completion_tokens: 5 } },
  },
};

function stubFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((url: string, init: RequestInit) => Promise.resolve(respond(url, init)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0]?.[1].body as string) as Record<string, unknown>;
}

async function caught(promise: Promise<unknown>): Promise<AiProviderError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AiProviderError);
  return error as AiProviderError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OllamaProvider', () => {
  it('sends a non-streaming, non-truncating chat request with the schema, limits and context size', async () => {
    const fetchMock = stubFetch(() => Response.json(OK_BODY.ollama));

    const response = await ollama().generate(REQUEST);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/chat');
    expect(sentBody(fetchMock)).toEqual({
      model: 'qwen2.5:3b',
      messages: [
        { role: 'system', content: 'You are a test.' },
        { role: 'user', content: 'Say ok.' },
      ],
      stream: false,
      truncate: false,
      format: SCHEMA,
      options: { temperature: 0, num_predict: 50, num_ctx: OLLAMA_CONTEXT_TOKENS },
    });
    expect(response).toMatchObject({
      text: '{"ok":true}',
      provider: 'ollama',
      model: 'qwen2.5:3b',
      inputTokens: 12,
      outputTokens: 5,
    });
  });

  it('omits format when no schema is requested', async () => {
    const fetchMock = stubFetch(() => Response.json(OK_BODY.ollama));
    const plain: AiRequest = { system: 'x', user: 'y', maxOutputTokens: 5, temperature: 0 };

    await ollama().generate(plain);

    expect(sentBody(fetchMock)).not.toHaveProperty('format');
  });

  it('reports an answer cut off by the token limit as invalid output', async () => {
    stubFetch(() => Response.json({ ...OK_BODY.ollama, done_reason: 'length' }));

    expect(await caught(ollama().generate(REQUEST))).toMatchObject({
      kind: 'invalid_output',
      retryable: true,
    });
  });

  it('reports a prompt larger than the context as a permanent invalid request', async () => {
    stubFetch(() =>
      Response.json(
        { error: 'request (12625 tokens) exceeds the available context size (8192 tokens)' },
        { status: 400 },
      ),
    );

    const error = await caught(ollama().generate(REQUEST));
    expect(error).toMatchObject({ kind: 'invalid_request', retryable: false });
    expect(error.message).toContain('exceeds the available context size');
  });

  it('reports a missing model as a permanent invalid request, with Ollama’s reason', async () => {
    stubFetch(() => Response.json({ error: "model 'qwen2.5:3b' not found" }, { status: 404 }));

    const error = await caught(ollama().generate(REQUEST));
    expect(error).toMatchObject({ kind: 'invalid_request', retryable: false });
    expect(error.message).toContain("model 'qwen2.5:3b' not found");
  });
});

describe('CloudflareProvider', () => {
  it('calls the account’s model endpoint with the token and json_schema response format', async () => {
    const fetchMock = stubFetch(() => Response.json(OK_BODY.cloudflare));

    const response = await cloudflare().generate(REQUEST);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).get('authorization')).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(sentBody(fetchMock)).toEqual({
      messages: [
        { role: 'system', content: 'You are a test.' },
        { role: 'user', content: 'Say ok.' },
      ],
      max_tokens: 50,
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
    });
    expect(response).toMatchObject({ text: '{"ok":true}', inputTokens: 12, outputTokens: 5 });
  });

  it('accepts JSON mode answers delivered as an object', async () => {
    stubFetch(() => Response.json({ success: true, result: { response: { ok: true } } }));

    expect(await cloudflare().generate(REQUEST)).toMatchObject({
      text: '{"ok":true}',
      inputTokens: null,
    });
  });

  it('classifies "JSON Mode couldn’t be met" as retryable invalid output', async () => {
    stubFetch(() =>
      Response.json(
        { success: false, errors: [{ code: 5025, message: "JSON Mode couldn't be met" }] },
        { status: 400 },
      ),
    );

    expect(await caught(cloudflare().generate(REQUEST))).toMatchObject({
      kind: 'invalid_output',
      retryable: true,
    });
  });
});

describe.each([
  ['ollama', ollama],
  ['cloudflare', cloudflare],
] as const)('%s error normalization', (_name, create: (timeoutMs?: number) => AiProvider) => {
  it.each([
    [401, 'authentication', false],
    [403, 'authentication', false],
    [400, 'invalid_request', false],
    [413, 'invalid_request', false],
    [408, 'timeout', true],
    [429, 'rate_limited', true],
    [500, 'unavailable', true],
    [503, 'unavailable', true],
  ] as const)('maps HTTP %i to %s (retryable: %s)', async (status, kind, retryable) => {
    stubFetch(() => new Response('<html>error</html>', { status }));

    const error = await caught(create().generate(REQUEST));
    expect(error).toMatchObject({ kind, retryable });
    expect(error.message).not.toContain(TOKEN);
  });

  it('passes on the Retry-After hint of a rate limit', async () => {
    stubFetch(() => new Response(null, { status: 429, headers: { 'Retry-After': '30' } }));

    expect(await caught(create().generate(REQUEST))).toMatchObject({ retryAfterMs: 30_000 });
  });

  it('reads a Retry-After given as an HTTP date, never as a negative wait', async () => {
    const retryAfter = async (value: string) => {
      stubFetch(() => new Response(null, { status: 429, headers: { 'Retry-After': value } }));
      return (await caught(create().generate(REQUEST))).retryAfterMs;
    };

    // HTTP dates have whole seconds, so up to a second is lost.
    const inAMinute = await retryAfter(new Date(Date.now() + 60_000).toUTCString());
    expect(inAMinute).toBeGreaterThanOrEqual(58_000);
    expect(inAMinute).toBeLessThanOrEqual(60_000);
    expect(await retryAfter('Thu, 01 Jan 2026 00:00:00 GMT')).toBe(0);
  });

  it('ignores a Retry-After it cannot read', async () => {
    stubFetch(() => new Response(null, { status: 429, headers: { 'Retry-After': 'soon' } }));

    expect((await caught(create().generate(REQUEST))).retryAfterMs).toBeUndefined();
  });

  it('reports a network failure as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );

    expect(await caught(create().generate(REQUEST))).toMatchObject({
      kind: 'unavailable',
      retryable: true,
    });
  });

  it('reports an unexpected success body as unavailable', async () => {
    stubFetch(() => Response.json({ surprise: true }));

    expect(await caught(create().generate(REQUEST))).toMatchObject({ kind: 'unavailable' });
  });

  it('gives up after its timeout', async () => {
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    expect(await caught(create(50).generate(REQUEST))).toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
  });

  it('rethrows a cancellation by the caller instead of calling it a provider failure', async () => {
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    const controller = new AbortController();
    const pending = create().generate({ ...REQUEST, signal: controller.signal });
    controller.abort(new Error('shutting down'));

    await expect(pending).rejects.toThrow('shutting down');
  });
});
