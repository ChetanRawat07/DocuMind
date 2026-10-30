import { vi } from 'vitest';

/**
 * Stand-in for XMLHttpRequest, which the API client uses for uploads
 * (fetch cannot report upload progress). Tests drive it: progress(),
 * respond(), fail().
 */
export class FakeXhr {
  static instances: FakeXhr[] = [];

  method = '';
  url = '';
  readonly headers: Record<string, string> = {};
  body: FormData | null = null;
  status = 0;
  responseText = '';
  aborted = false;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: FormData) {
    this.body = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }

  respond(status: number, body?: unknown) {
    this.status = status;
    this.responseText = body === undefined ? '' : JSON.stringify(body);
    this.onload?.();
  }

  fail() {
    this.onerror?.();
  }
}

/** Replaces XMLHttpRequest; returns the list of requests made, in order. */
export function stubXhr(): FakeXhr[] {
  FakeXhr.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return FakeXhr.instances;
}

/** Waits until request number `index` (0-based) has been made, and returns it. */
export async function waitForRequest(requests: FakeXhr[], index: number): Promise<FakeXhr> {
  await vi.waitFor(() => {
    if (!requests[index]) throw new Error(`request ${index} not made yet`);
  });
  const request = requests[index];
  if (!request) throw new Error(`request ${index} not made`);
  return request;
}
