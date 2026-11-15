import type { AdapterConfig } from '@/config/schema';
import type { PageTokens } from './page-globals';
import { logger } from '@/shared/log';

const log = logger('batchexecute');

export class RpcError extends Error {
  constructor(
    message: string,
    readonly rpcId: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface Transport {
  call(rpcId: string, args: unknown): Promise<unknown>;
}

interface Deps {
  cfg: AdapterConfig;
  tokens: () => PageTokens;
  fetchImpl?: typeof fetch;
  origin?: string;
  sourcePath?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Minimal client for Google's batchexecute RPC envelope, as used by the
 * Google Photos web app. One RPC per request. Includes retry with backoff,
 * a concurrency gate and a minimum interval between requests.
 *
 * Request: POST {origin}{path}{endpointSuffix}?rpcids=..&source-path=..&f.sid=..&bl=..&pageId=none&rt=c[&rapt=..]
 * Body:    f.req=<json [[[rpcid, <json args>, null, "generic"]]]>&at=<token>&
 * Response: chunked text; the line containing "wrb.fr" is a JSON array whose
 *           [0][2] is the JSON-encoded payload.
 */
export class BatchExecuteTransport implements Transport {
  private inflight = 0;
  private queue: (() => void)[] = [];
  private lastStart = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: Deps) {
    this.fetchImpl = deps.fetchImpl ?? fetch.bind(globalThis);
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async call(rpcId: string, args: unknown): Promise<unknown> {
    await this.acquire();
    try {
      return await this.withRetry(rpcId, args);
    } finally {
      this.release();
    }
  }

  private async withRetry(rpcId: string, args: unknown): Promise<unknown> {
    const { maxRetries, retryBaseDelayMs } = this.deps.cfg.transport;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.once(rpcId, args);
      } catch (e) {
        lastErr = e;
        const status = e instanceof RpcError ? e.status : undefined;
        // Do not retry auth failures: the page tokens are stale and the caller
        // must reload them.
        if (status === 401 || status === 403) throw e;
        if (attempt < maxRetries) {
          const delay = retryBaseDelayMs * 2 ** (attempt - 1);
          log.warn(`rpc ${rpcId} attempt ${attempt} failed, retrying in ${delay}ms`, e);
          await this.sleep(delay);
        }
      }
    }
    throw lastErr;
  }

  private async once(rpcId: string, args: unknown): Promise<unknown> {
    const { cfg } = this.deps;
    const t = this.deps.tokens();
    const origin = this.deps.origin ?? 'https://photos.google.com';
    const params = new URLSearchParams();
    params.set('rpcids', rpcId);
    params.set('source-path', this.deps.sourcePath?.() ?? '/');
    params.set('f.sid', t.sid);
    params.set('bl', t.bl);
    params.set('pageId', 'none');
    params.set('rt', 'c');
    if (t.rapt) params.set('rapt', t.rapt);

    const url = `${origin}${t.path}${cfg.transport.endpointSuffix}?${params.toString()}`;
    const envelope = [[[rpcId, JSON.stringify(args), null, 'generic']]];
    const body = `f.req=${encodeURIComponent(JSON.stringify(envelope))}&at=${encodeURIComponent(t.at)}&`;

    // Pace requests.
    const gap = cfg.transport.minIntervalMs - (Date.now() - this.lastStart);
    if (gap > 0) await this.sleep(gap);
    this.lastStart = Date.now();

    const res = await this.fetchImpl(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    });
    if (!res.ok) throw new RpcError(`HTTP ${res.status}`, rpcId, res.status);
    const text = await res.text();
    return parseBatchExecuteResponse(text, rpcId);
  }

  private acquire(): Promise<void> {
    if (this.inflight < this.deps.cfg.transport.concurrency) {
      this.inflight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => { this.inflight++; resolve(); }));
  }

  private release() {
    this.inflight--;
    this.queue.shift()?.();
  }
}

/** Parse the chunked batchexecute body and return the decoded payload. */
export function parseBatchExecuteResponse(text: string, rpcId: string): unknown {
  const line = text.split('\n').find((l) => l.includes('wrb.fr'));
  if (!line) throw new RpcError('no wrb.fr frame in response', rpcId);
  let outer: unknown;
  try {
    outer = JSON.parse(line);
  } catch {
    throw new RpcError('response frame is not JSON', rpcId);
  }
  const frame = Array.isArray(outer) ? outer.find((f) => Array.isArray(f) && f[0] === 'wrb.fr') ?? outer[0] : null;
  const payload = Array.isArray(frame) ? frame[2] : undefined;
  if (typeof payload !== 'string') {
    // Google signals errors as a frame with null payload and an error code
    // further along; surface it rather than returning undefined.
    throw new RpcError(`empty payload for ${rpcId}`, rpcId);
  }
  try {
    return JSON.parse(payload);
  } catch {
    throw new RpcError('payload is not JSON', rpcId);
  }
}
