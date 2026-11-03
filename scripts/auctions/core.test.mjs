import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, normalizeLot, dedupeLots, mergePrevious } from './core.mjs';
const NOW = '2026-11-03T10:00:00Z';
const raw = extra => ({ address: 'Flat 1, 10 Example Street, Manchester, M1 2AB', title: 'Flat 1', property_type: 'Flat', status: 'Upcoming', auction_date: '2026-11-20', source_url: 'https://example.test/lot/1', ...extra });
const norm = extra => normalizeLot(raw(extra), { source: 'Test', now: NOW });
const lot = extra => norm(extra).lot;
function harness(robots, routes = {}, options = {}) {
  let clock = 0; const calls = [], waits = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, time: clock });
    const value = url.endsWith('/robots.txt') ? robots : routes[new URL(url).pathname + new URL(url).search];
    if (value instanceof Error) throw value;
    if (typeof value === 'function') return value(url, init);
    const v = typeof value === 'string' ? { body: value } : value || { body: 'OK' };
    return new Response(v.body ?? '', { status: v.status || 200, headers: { 'Content-Type': 'text/plain', ...v.headers } });
  };
  const client = createClient({ fetchImpl, now: () => clock, sleepImpl: async ms => { waits.push(ms); clock += ms; }, ...options });
  return { client, calls, waits };
}
test('robots most-specific groups merge, wildcard excluded and allow ties win', async () => {
  const h = harness('User-agent: *\nDisallow: /\nUser-agent: LauritoAuctionsBot\nDisallow: /private*\nAllow: /private/public\nUser-agent: LauritoAuctionsBot\nDisallow: /same\nAllow: /same\n');
  assert.equal(await h.client('/invalid').catch(e => e.code), 'URL');
  assert.equal(await h.client('https://a.test/open'), 'OK');
  await assert.rejects(h.client('https://a.test/private?q=1'), { code: 'ROBOTS_DISALLOW' });
  assert.equal(await h.client('https://a.test/private/public'), 'OK');
  assert.equal(await h.client('https://a.test/same'), 'OK');
  assert.equal(h.calls.filter(c => c.url.includes('/private?q')).length, 0);
});
test('robots wildcard, dollar anchors and query rules', async () => {
  const h = harness('User-agent: *\nDisallow: /*?id=*$\nDisallow: /closed$\n');
  await assert.rejects(h.client('https://a.test/lot?id=1'), { code: 'ROBOTS_DISALLOW' });
  await assert.rejects(h.client('https://a.test/closed'), { code: 'ROBOTS_DISALLOW' });
  assert.equal(await h.client('https://a.test/closed/child'), 'OK');
  assert.equal(h.calls.filter(c => c.url.includes('?id=')).length, 0);
});
test('crawl delay and throttle persist across HTTP errors', async () => {
  const h = harness('User-agent: *\nCrawl-delay: 4\n', { '/bad': { status: 500 }, '/fine': 'good' });
  await assert.rejects(h.client('https://a.test/bad'), { code: 'HTTP' });
  assert.equal(await h.client('https://a.test/fine'), 'good');
  assert.deepEqual(h.calls.map(c => c.time), [0, 4000, 8000]);
  assert.equal(h.calls[0].init.credentials, 'omit');
  assert.equal(h.calls[0].init.redirect, 'manual');
  assert.equal(h.calls[0].init.headers['User-Agent'], 'LauritoAuctionsBot/1.0');
  assert.equal(h.calls[0].init.headers.Cookie, undefined);
});
test('robots failures close access; only 404 and 410 permit', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const h = harness({ status }); await assert.rejects(h.client('https://a.test/lot'));
    assert.equal(h.calls.length, 1);
  }
  for (const status of [404, 410]) { const h = harness({ status }); assert.equal(await h.client('https://a.test/lot'), 'OK'); }
  for (const rb of [new Error('offline'), { body: '<html>challenge</html>' }, { body: '', headers: { 'Content-Type': 'text/html' } }]) {
    const h = harness(rb); await assert.rejects(h.client('https://a.test/lot')); assert.equal(h.calls.length, 1);
  }
});
test('robots fetched once per origin per client and afresh next run', async () => {
  const h = harness('User-agent: *\nAllow: /');
  await h.client('https://a.test/a'); await h.client('https://a.test/b'); await h.client('https://b.test/c');
  assert.equal(h.calls.filter(c => c.url.endsWith('/robots.txt')).length, 2);
  const h2 = harness('User-agent: *\nDisallow: /'); await assert.rejects(h2.client('https://a.test/a'), { code: 'ROBOTS_DISALLOW' });
});
test('redirect paths recheck robots, cross-origin refused and loops capped', async () => {
  const h = harness('User-agent: *\nDisallow: /secret', { '/go': { status: 302, headers: { Location: '/secret' } } });
  await assert.rejects(h.client('https://a.test/go'), { code: 'ROBOTS_DISALLOW' }); assert.equal(h.calls.length, 2);
  const x = harness('', { '/go': { status: 302, headers: { Location: 'https://b.test/lot' } } });
  await assert.rejects(x.client('https://a.test/go'), { code: 'REDIRECT_POLICY' }); assert.equal(x.calls.length, 2);
  const loop = harness('', { '/go': { status: 302, headers: { Location: '/go' } } }, { maxRedirects: 1 });
  await assert.rejects(loop.client('https://a.test/go'), { code: 'REDIRECT_LIMIT' }); assert.equal(loop.calls.length, 3);
});
test('byte cap, request cap, credentials and challenges fail safely', async () => {
  const h = harness('', { '/large': 'a'.repeat(25) }, { maxBytes: 20 }); await assert.rejects(h.client('https://a.test/large'), { code: 'BYTE_LIMIT' });
  const r = harness('', {}, { maxRequests: 1 }); await assert.rejects(r.client('https://a.test/lot'), { code: 'REQUEST_LIMIT' });
  const c = harness('', { '/lot': '<title>Just a moment...</title><input type="password">' }); await assert.rejects(c.client('https://a.test/lot'), { code: 'CHALLENGE' });
  await assert.rejects(c.client('https://a.test/login'), { code: 'LOGIN' });
  await assert.rejects(c.client('https://name:password@a.test/'), { code: 'URL' });
});
test('target cities require explicit property posttown and matching complete postcode', () => {
  for (const [town, postcode] of [['Manchester', 'M1 2AB'], ['Glasgow', 'G1 1AA'], ['Edinburgh', 'EH1 1AA'], ['Bristol', 'BS1 1AA'], ['Cheltenham', 'GL50 1AA']]) {
    assert.equal(norm({ address: '10 Example Road, ' + town + ', ' + postcode }).lot.town, town);
  }
  for (const address of ['10 Manchester Road, Middleton, M24 1AA', '50 Edinburgh Road, Chatham, ME4 5BZ', '10 Example Road, Gloucester, GL1 1AA', '10 Example Road, M1 2AB', '10 Example Road, Cheltenham, GL1 1AA']) assert.equal(norm({ address, header: 'Manchester Glasgow Edinburgh Bristol Cheltenham' }).reason, 'out_of_area');
  assert.equal(norm({ address: '10 Example Street Manchester M99 1AA' }).lot.town, 'Manchester');
});
test('all residential classes and exclusions are conservative', () => {
  const types = { 'Townhouse': 'Houses', 'Apartment': 'Flats', 'Block of flats': 'Blocks', HMO: 'HMO', 'Residential portfolio': 'Portfolios', 'Mixed-use': 'Mixed-use', 'Residential development': 'Development' };
  for (const [property_type, expected] of Object.entries(types)) {
    const n = norm({ title: 'Example', property_type, description: 'Planning permission granted for 3 residential dwellings' }); assert.equal(n.lot?.residential_subtype, expected, property_type);
  }
  for (const property_type of ['Retail shop', 'Office', 'Agricultural land', 'Garage', 'Parking', 'Ground rents over flats']) assert.equal(norm({ title: property_type, property_type }).reason, 'commercial');
  assert.equal(norm({ title: 'Unknown opportunity', property_type: 'Other' }).reason, 'unknown_type');
  assert.equal(norm({ title: 'Land', property_type: 'Land', description: 'Potential for residential planning' }).reason, 'commercial');
  assert.equal(norm({ title: 'Land', property_type: 'Land', description: 'Planning permission granted for residential flats' }).lot.residential_subtype, 'Development');
});
test('unknown and stale upcoming statuses never fabricated, prices stay separate', () => {
  assert.equal(norm({ status: 'Guide price' }).reason, 'unknown_status');
  assert.equal(norm({ status: 'Upcoming', auction_date: '2026-10-20' }).reason, 'unknown_status');
  assert.equal(norm({ status: 'Upcoming', auction_date: null }).lot.status, 'upcoming');
  assert.equal(norm({ status: 'sold', auction_date: '2026-10-20' }).lot.status, 'sold');
  const l = lot({ guide_price: '£100,000+', opening_bid: 90000, current_bid: 101000, price: 999999, sold_price: null });
  assert.deepEqual([l.guide_price, l.opening_bid, l.current_bid, l.sold_price], [100000, 90000, 101000, null]);
  assert.equal(lot({ guide_price: '£100,000 - £120,000' }).guide_price, null);
});
test('grading requires explicit verified evidence and link, not auction or potential receiver', () => {
  assert.equal(lot({ grade: 'A', title: 'Auction flat receiver potential' }).grade, null);
  assert.equal(lot({ grade: 'A', grade_verified: true, grade_evidence: 'Verified owner filing', grade_evidence_url: 'https://registry.test/1' }).grade, 'A');
  assert.equal(lot({ forced_sale_evidence: 'Instructed by the receiver', forced_sale_evidence_url: 'https://example.test/receiver' }).grade, 'B');
  assert.equal(lot({ forced_sale_evidence: 'Potential receiver may be appointed' }).grade, null);
  assert.equal(lot({ grade: 'C', grade_verified: true }).grade, null);
});
test('dedup preserves units, titles, auction events and sourced provenance', () => {
  const one = lot(), two = lot({ address: 'Flat 2, 10 Example Street, Manchester, M1 2AB', title: 'Flat 2' });
  const same = { ...one, source: 'Second', sources: [{ name: 'Second', url: 'https://second.test/1' }], source_url: 'https://second.test/1', provenance: [{ source: 'Second', status: 'sold', source_url: 'https://second.test/1' }], status: 'sold' };
  assert.equal(dedupeLots([one, two]).length, 2);
  assert.equal(dedupeLots([one, { ...one, auction_date: '2026-12-20' }]).length, 2);
  assert.equal(dedupeLots([one, { ...one, title: 'Separate leasehold interest' }]).length, 2);
  const d = dedupeLots([one, same]); assert.equal(d.length, 1); assert.equal(d[0].status, 'sold'); assert.equal(d[0].sources.length, 2); assert.equal(d[0].provenance.length, 2);
  const newer = { ...one, scraped_at: '2026-11-04T10:00:00Z', status: 'withdrawn', sold_price: null };
  assert.equal(dedupeLots([same, newer])[0].status, 'withdrawn');
});
test('null-date rows merge only with a unique different-source same-asset event', () => {
  const dated = lot(), unknown = { ...dated, auction_date: null, source: 'Second', sources: [{ name: 'Second', url: 'https://second.test/a' }] };
  assert.equal(dedupeLots([dated, unknown]).length, 1);
  assert.equal(dedupeLots([dated, { ...unknown, source: dated.source, sources: dated.sources }]).length, 2);
  assert.equal(dedupeLots([dated, { ...dated, auction_date: '2026-12-20' }, unknown]).length, 3);
});
test('merge retains unavailable and successful-crawl missing rows stale without invented sales', () => {
  const old = lot({ scraped_at: '2026-11-01T10:00:00Z' });
  for (const [coverage, reason] of [[{}, 'source_unavailable'], [{ Test: { status: 'success' } }, 'missing_from_successful_crawl']]) {
    const merged = mergePrevious([], [old], coverage, NOW); assert.equal(merged.length, 1); assert.equal(merged[0].stale, true); assert.equal(merged[0].status, 'upcoming'); assert.equal(merged[0].scraped_at, old.scraped_at); assert.equal(merged[0].stale_reason, reason);
  }
  assert.equal(mergePrevious([old], [old], {}, NOW)[0].stale, false);
  assert.equal(mergePrevious([], [{ ...old, scraped_at: '2026-09-01T00:00:00Z' }], {}, NOW).length, 0);
  assert.equal(mergePrevious([], [{ ...old, status: 'sold', scraped_at: '2025-01-01T00:00:00Z' }], {}, NOW).length, 1);
  assert.equal(mergePrevious([], [{ ...old, status: 'sold', scraped_at: '2023-01-01T00:00:00Z' }], {}, NOW).length, 0);
});

test('integration statuses are lowercase, available needs dated context and no_bids is unsold', () => {
  assert.equal(norm({ status: 'available', auction_date: '2026-11-20' }).lot.status, 'upcoming');
  assert.equal(norm({ status: 'available', auction_date: '2026-10-20' }).lot.status, 'unsold');
  assert.equal(norm({ status: 'available', auction_date: null }).reason, 'unknown_status');
  assert.equal(norm({ status: 'no_bids', auction_date: '2026-10-20' }).lot.status, 'unsold');
});
test('studios and explicit residential development/conversion require no guessed planning consent', () => {
  assert.equal(norm({ title: 'Studio', property_type: 'Studio' }).lot.residential_subtype, 'Flats');
  assert.equal(norm({ title: 'Residential development site', property_type: 'Land' }).lot.residential_subtype, 'Development');
  assert.equal(norm({ title: 'Conversion to residential', property_type: 'Development' }).lot.residential_subtype, 'Development');
  assert.equal(norm({ title: 'Building plot', property_type: 'Land', residential_verified: true }).lot.residential_subtype, 'Development');
  assert.equal(norm({ title: 'Commercial development', property_type: 'Development' }).reason, 'commercial');
});
test('metadata whitelist excludes descriptions/images and IDs are stable per asset/event', () => {
  const first = lot({ description: 'Private copied paragraph', images: ['photo.jpg'], arbitrary: 'untrusted' });
  assert.equal(first.description, undefined); assert.equal(first.images, undefined); assert.equal(first.arbitrary, undefined);
  assert.equal(first.id, lot().id);
  assert.equal(first.id === lot({ auction_date: '2026-12-20' }).id, false);
  assert.equal(first.id === lot({ address: 'Flat 2, 10 Example Street, Manchester, M1 2AB' }).id, false);
});
test('dedup county/posttown variants and marketing titles but never units or partial addresses', () => {
  const a = lot({ title: 'Beautiful one-bedroom apartment' });
  const b = lot({ title: 'Investment opportunity', address: 'Flat1, 10 Example Street, Manchester, Greater Manchester, M1 2AB' });
  assert.equal(dedupeLots([a,b]).length, 1); assert.equal(a.id,b.id);
  const two = lot({ title: 'Investment opportunity', address: 'Flat 2, 10 Example Street, Manchester, Greater Manchester, M1 2AB' });
  assert.equal(dedupeLots([a,two]).length, 2);
  assert.equal(dedupeLots([{...a,address:'Example Street, Manchester, M1 2AB'}, {...b,address:'Example Street, Manchester, M1 2AB'}]).length, 2);
});
test('runner coverage sources supports live and partial aliases', () => {
  for (const status of ['live','partial']) {
    const out = mergePrevious([], [lot()], {sources:[{id:'test',name:'Test',status}]}, NOW);
    assert.equal(out[0].stale_reason, 'missing_from_successful_crawl');
  }
});
test('public lot page with auth modal allowed, login wall still blocked', async () => {
  const h = harness('', {'/lot':'<title>Auction catalogue</title><main><h1>Auction lots</h1>Lot 1 Guide price £100</main><dialog hidden><form><h2>Login</h2><input type="password">Please log in to view favourites</form></dialog>'});
  assert.equal((await h.client('https://a.test/lot')).includes('Lot 1'), true);
  const wall = harness('', {'/lot':'<title>Login required</title><form><input type="password">Please log in to continue</form>'});
  await assert.rejects(wall.client('https://a.test/lot'), {code:'CHALLENGE'});
});

test('original ground-rent and commercial interests override inferred residential labels', () => {
  for (const residential_subtype of ['Blocks', 'Flats', 'Houses']) {
    assert.equal(norm({ title: '10 Example Street', lot_type: 'Freehold ground rents over 2 flats', residential_subtype }).reason, 'commercial');
    assert.equal(norm({ title: 'Named block: Example House', lot_type: 'Ground rent only interest', residential_subtype }).reason, 'commercial');
    assert.equal(norm({ title: '10 Example Street', lot_type: 'Commercial office', residential_subtype }).reason, 'commercial');
    assert.equal(norm({ title: 'Commercial office', lot_type: 'Houses', residential_subtype }).reason, 'commercial');
    assert.equal(norm({ title: '10 Example Street', lot_type: 'Agricultural land', residential_subtype }).reason, 'commercial');
  }
  assert.equal(norm({ title: 'Freehold ground rents over a named block', lot_type: 'Blocks', residential_subtype: 'Blocks' }).reason, 'commercial');
  assert.equal(norm({ title: 'Whole block of 2 flats', lot_type: 'Block of flats', residential_subtype: 'Blocks' }).lot.residential_subtype, 'Blocks');
});
test('explicit title unit identifiers distinguish same-building lots and stable IDs', () => {
  const address = '10 Example Street, Manchester, M1 2AB';
  const a = lot({ address, title: 'Flat1', property_type: 'Flat' });
  const b = lot({ address, title: 'Flat2', property_type: 'Flat' });
  assert.equal(dedupeLots([a, b]).length, 2);
  assert.equal(a.id === b.id, false);
  const variant = lot({ address, title: 'Bright investment apartment 1', property_type: 'Apartment' });
  assert.equal(a.id, variant.id);
  assert.equal(dedupeLots([a, variant]).length, 1);
  const explicit = lot({ address: 'Flat 1, ' + address, title: 'Bright investment apartment 1', property_type: 'Apartment' });
  const marketing = lot({ address: 'Flat 1, ' + address, title: 'Investment opportunity', property_type: 'Apartment' });
  assert.equal(explicit.id, marketing.id);
  assert.equal(dedupeLots([explicit, marketing]).length, 1);
});
test('actual whole-block and individual-flat interests never merge at same building', () => {
  const address = '10 Example Street, Manchester, M1 2AB';
  const block = lot({ address, title: 'Whole block of flats', lot_type: 'Block of flats', residential_subtype: 'Blocks' });
  const flat = lot({ address, title: 'Flat1', lot_type: 'Flat', residential_subtype: 'Flats' });
  const unnumbered = lot({ address, title: 'Individual leasehold flat', lot_type: 'Flat', residential_subtype: 'Flats' });
  assert.equal(dedupeLots([block, flat, unnumbered]).length, 3);
  assert.equal(block.id === flat.id, false);
  assert.equal(block.id === unnumbered.id, false);
  assert.equal(flat.id === unnumbered.id, false);
});

test('zero guide and sold placeholders are null without changing explicit bid values', () => {
  const p = lot({ guide_price: 0, sold_price: '£0', opening_bid: 45000, current_bid: 0 });
  assert.equal(p.guide_price, null); assert.equal(p.sold_price, null);
  assert.equal(p.provenance[0].guide_price, null); assert.equal(p.provenance[0].sold_price, null);
  assert.equal(p.opening_bid, 45000); assert.equal(p.current_bid, 0);
});
