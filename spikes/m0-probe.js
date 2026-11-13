/*
 * Milestone 0 probe. Paste into DevTools on https://photos.google.com while
 * signed in to the TEST account (never a personal one).
 *
 * It calls the read-only RPCs the extension depends on, prints a summary and
 * downloads a JSON file of raw responses. Send that file back: it becomes the
 * test fixtures and confirms or corrects src/config/default-config.ts.
 *
 * Nothing destructive runs unless you call psc.trashRoundTrip(n) yourself,
 * which trashes n items and immediately restores them.
 */
(async () => {
  const RPC = {
    listByTakenDate: 'lcxiM',
    batchMediaInfo: 'EWgK9e',
    storageQuota: 'EzwWhf',
    itemInfo: 'VrseUb',
    trashList: 'zy0IHe',
    trashOrRestore: 'XwAOJf',
  };

  const g = window.WIZ_global_data;
  if (!g) throw new Error('WIZ_global_data not found. Is this photos.google.com?');
  const tokens = { at: g.SNlM0e, sid: g.FdrFJe, bl: g.cfb2h, path: g.eptZe || '/_/PhotosUi/', rapt: g.Dbw5Ud };
  console.log('[psc] tokens present:', Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, typeof v === 'string' && v.length > 0])));

  async function call(rpcid, args) {
    const p = new URLSearchParams({ rpcids: rpcid, 'source-path': location.pathname, 'f.sid': tokens.sid, bl: tokens.bl, pageId: 'none', rt: 'c' });
    if (typeof tokens.rapt === 'string') p.set('rapt', tokens.rapt);
    const body = `f.req=${encodeURIComponent(JSON.stringify([[[rpcid, JSON.stringify(args), null, 'generic']]]))}&at=${encodeURIComponent(tokens.at)}&`;
    const t0 = performance.now();
    const res = await fetch(`${location.origin}${tokens.path}data/batchexecute?${p}`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body,
    });
    const text = await res.text();
    const line = text.split('\n').find((l) => l.includes('wrb.fr'));
    const payload = line ? JSON.parse(JSON.parse(line)[0][2] ?? 'null') : null;
    return { status: res.status, ms: Math.round(performance.now() - t0), payload };
  }

  const out = { capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, results: {} };
  const record = (name, r) => { out.results[name] = r; console.log(`[psc] ${name}: HTTP ${r.status} in ${r.ms}ms`); };

  // 1. Storage quota.
  const quota = await call(RPC.storageQuota, []);
  record('storageQuota', quota);
  console.log('[psc] quota [6]:', quota.payload?.[6]);

  // 2. Enumerate up to 1,000 items, timing each page.
  let pageId = null;
  const items = [];
  const pages = [];
  do {
    const r = await call(RPC.listByTakenDate, [pageId, null, 500, null, 1, 1]);
    pages.push({ status: r.status, ms: r.ms, count: r.payload?.[0]?.length ?? 0 });
    if (pages.length === 1) record('listByTakenDate.firstPage', r);
    items.push(...(r.payload?.[0] ?? []));
    pageId = r.payload?.[1] || null;
  } while (pageId && items.length < 1000);
  out.results.listTimings = pages;
  console.log(`[psc] enumerated ${items.length} items over ${pages.length} pages`);

  // 3. Sizes and quota flags for the first 500.
  const keys = items.slice(0, 500).map((i) => [i[0]]);
  const mask = [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, [], null, null, null, null, null, null, null, null, null, null, null, []];
  const info = await call(RPC.batchMediaInfo, [[[keys]], [mask]]);
  record('batchMediaInfo', info);
  const rows = info.payload?.[0]?.[1] ?? [];
  const withSize = rows.filter((r) => typeof r?.[1]?.[9] === 'number').length;
  const freeItems = rows.filter((r) => r?.[1]?.at?.(-1)?.[0] === 0).length;
  console.log(`[psc] media info rows ${rows.length}, with size ${withSize}, not counting against quota ${freeItems}`);

  // 4. Item info for one photo and one video (download URLs).
  const photo = items.find((i) => !i.at(-1)?.['76647426']);
  const video = items.find((i) => i.at(-1)?.['76647426']);
  if (photo) record('itemInfo.photo', await call(RPC.itemInfo, [photo[0], null, null, null, null]));
  if (video) record('itemInfo.video', await call(RPC.itemInfo, [video[0], null, null, null, null]));

  // 5. Trash listing.
  record('trashList', await call(RPC.trashList, [null]));

  // Save everything.
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `psc-m0-${Date.now()}.json` });
  a.click();
  console.log('[psc] saved raw capture. Send the downloaded JSON file back.');

  // Optional destructive round trip, run manually: psc.trashRoundTrip(5)
  window.psc = {
    call,
    async trashRoundTrip(n = 5) {
      const dedup = items.slice(-n).map((i) => i[3]).filter(Boolean);
      console.log('[psc] trashing then restoring', dedup.length, 'items');
      const t = await call(RPC.trashOrRestore, [null, 1, dedup, 3]);
      const r = await call(RPC.trashOrRestore, [null, 3, dedup, 2]);
      console.log('[psc] trash', t.status, 'restore', r.status);
      return { trash: t, restore: r };
    },
  };
})();
