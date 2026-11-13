import { describe, expect, it, vi } from 'vitest';
import { BatchExecuteTransport, parseBatchExecuteResponse, RpcError } from '@/adapter/google/batchexecute';
import { GoogleAdapter } from '@/adapter/google/google-adapter';
import { extractTokensFromHtml } from '@/adapter/google/page-globals';
import { parseLibraryItem, parseMediaInfo, parseStorageQuota, stripThumbSuffix, thumbUrlForSize } from '@/adapter/google/parsers';
import { DEFAULT_CONFIG as cfg } from '@/config/default-config';

/**
 * These fixtures are shaped after the observed protocol, not captured from a
 * live account. Milestone 0 replaces them with real captures from the test
 * account (docs/IMPLEMENTATION_PLAN.md).
 */
const frame = (payload: unknown) => `)]}'\n\n123\n${JSON.stringify([['wrb.fr', 'x', JSON.stringify(payload), null, null, null, 'generic']])}\n25\n[["e",4,null,null,123]]\n`;

const rawItem = (key: string) => [
  key, ['https://lh3.googleusercontent.com/abc=w200-h100', 4032, 3024], 1717236000000, `dedup-${key}`, 7200000, 1717239600000,
  null, [], null, null, null, null, [0], false,
  { '163238866': [true], '76647426': undefined },
];

describe('batchexecute envelope', () => {
  it('extracts the wrb.fr payload', () => {
    expect(parseBatchExecuteResponse(frame({ a: 1 }), 'r')).toEqual({ a: 1 });
  });
  it('throws on missing frames and empty payloads', () => {
    expect(() => parseBatchExecuteResponse(')]}\'\n[]', 'r')).toThrow(RpcError);
    expect(() => parseBatchExecuteResponse(JSON.stringify([['wrb.fr', 'r', null]]), 'r')).toThrow(/empty payload/);
  });

  it('builds the request the web app sends and retries transient failures', async () => {
    const calls: { url: string; body: string }[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      n++;
      if (n === 1) return new Response('oops', { status: 500 });
      return new Response(frame([[], null]), { status: 200 });
    }) as unknown as typeof fetch;
    const t = new BatchExecuteTransport({
      cfg: { ...cfg, transport: { ...cfg.transport, minIntervalMs: 0 } },
      tokens: () => ({ at: 'AT:1', sid: '-123', bl: 'boq_x', path: '/_/PhotosUi/', rapt: null }),
      fetchImpl,
      sleep: async () => {},
    });
    await t.call('lcxiM', [null, null, 500]);
    expect(n).toBe(2);
    const url = new URL(calls[1]!.url);
    expect(url.pathname).toBe('/_/PhotosUi/data/batchexecute');
    expect(url.searchParams.get('rpcids')).toBe('lcxiM');
    expect(url.searchParams.get('f.sid')).toBe('-123');
    expect(url.searchParams.get('rt')).toBe('c');
    const body = new URLSearchParams(calls[1]!.body);
    expect(body.get('at')).toBe('AT:1');
    expect(JSON.parse(body.get('f.req')!)).toEqual([[['lcxiM', '[null,null,500]', null, 'generic']]]);
  });

  it('does not retry auth failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    const t = new BatchExecuteTransport({ cfg, tokens: () => ({ at: 'a', sid: 's', bl: 'b', path: '/', rapt: null }), fetchImpl, sleep: async () => {} });
    await expect(t.call('x', [])).rejects.toThrow(/401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('page tokens', () => {
  it('parses WIZ_global_data out of inline script text', () => {
    const html = `window.WIZ_global_data = {"SNlM0e":"tok:1","FdrFJe":"-42","cfb2h":"boq_photos","eptZe":"/_/PhotosUi/","x":"a}b"};`;
    expect(extractTokensFromHtml(html, cfg)).toEqual({ at: 'tok:1', sid: '-42', bl: 'boq_photos', path: '/_/PhotosUi/', rapt: null });
  });
  it('returns null when tokens are missing', () => {
    expect(extractTokensFromHtml('window.WIZ_global_data = {"a":1};', cfg)).toBeNull();
  });
});

describe('parsers', () => {
  it('parses a library item', () => {
    const m = parseLibraryItem(rawItem('k1'), cfg)!;
    expect(m.mediaKey).toBe('k1');
    expect(m.dedupKey).toBe('dedup-k1');
    expect(m.width).toBe(4032);
    expect(m.isFavorite).toBe(true);
    expect(m.durationMs).toBeNull();
    expect(m.thumbUrl).toBe('https://lh3.googleusercontent.com/abc');
    expect(m.sizeBytes).toBeNull();
  });

  it('parses batch media info including the quota flag', () => {
    const payload = [[null, [
      ['k1', [null, null, null, 'IMG_1.jpg', null, null, 1717239600000, 0, 0, 3500000, null, [1, 3500000, 1]]],
      ['k2', [null, null, null, 'IMG_2.jpg', null, null, 1717239600000, 0, 0, 2000000, null, [0, 0, 2]]],
    ]]];
    const info = parseMediaInfo(payload, cfg);
    expect(info).toEqual([
      { mediaKey: 'k1', fileName: 'IMG_1.jpg', sizeBytes: 3500000, takesUpSpace: true, spaceTakenBytes: 3500000, uploadedAt: 1717239600000 },
      { mediaKey: 'k2', fileName: 'IMG_2.jpg', sizeBytes: 2000000, takesUpSpace: false, spaceTakenBytes: 0, uploadedAt: 1717239600000 },
    ]);
  });

  it('parses storage quota', () => {
    const payload = [null, null, null, null, null, null, [1000, 16106127360, null, 800]];
    const q = parseStorageQuota(payload, cfg, 5);
    expect(q).toEqual({ usedBytes: 1000, limitBytes: 16106127360, usedByPhotosBytes: 800, fetchedAt: 5 });
  });

  it('rewrites thumbnail sizes', () => {
    expect(stripThumbSuffix('https://lh3.googleusercontent.com/p/abc=w10-h10')).toBe('https://lh3.googleusercontent.com/p/abc');
    expect(thumbUrlForSize('https://lh3.googleusercontent.com/p/abc=w10', 224, 224, cfg)).toBe('https://lh3.googleusercontent.com/p/abc=w224-h224-no');
  });
});

describe('GoogleAdapter', () => {
  it('sends trash and restore with the observed argument shapes, in batches', async () => {
    const calls: [string, unknown][] = [];
    const transport = { call: async (id: string, args: unknown) => { calls.push([id, args]); return [[]]; } };
    const a = new GoogleAdapter(transport, { ...cfg, limits: { ...cfg.limits, trashBatch: 2 } });
    await a.trashItems(['d1', 'd2', 'd3']);
    await a.restoreItems(['d1']);
    expect(calls).toEqual([
      ['XwAOJf', [null, 1, ['d1', 'd2'], 3]],
      ['XwAOJf', [null, 1, ['d3'], 3]],
      ['XwAOJf', [null, 3, ['d1'], 2]],
    ]);
  });
});
