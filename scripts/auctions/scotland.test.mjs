import test from 'node:test';
import assert from 'node:assert/strict';
import { collect } from './scotland.mjs';

// Entirely synthetic examples. No live auction lots or network requests.
const now = '2026-11-03T12:00:00Z';
const futureCatalogue = 'https://www.futurepropertyauctions.co.uk/catalogue_viewall.asp';
const futureDetail = 'https://www.futurepropertyauctions.co.uk/property_details.asp?id=999999999';
const braveCatalogue = 'https://braveheartauctions.co.uk/auctions/';
const braveDetail = 'https://braveheartauctions.co.uk/product/synthetic-test-only-glasgow/';
function futurePage(status = 'Available', address = '999 Synthetic Test Street, Glasgow, G1 1AA') {
  return '<title>GUIDE PRICE £75,000</title><h2>2 Bedroom Flat <span>LOT 999999</span></h2><a class="listing-address">' + address + '</a><p>Status: ' + status + '</p><p>Type: Flat</p><h4>5 November 2026, 9am-3pm</h4><p>Opening Bid: £75,000</p><p>Current bid: £90,000</p>';
}
function futureRun(detail = futurePage()) {
  const pages = {
    [futureCatalogue]: '<div class="listing-item"><a href="' + futureDetail + '">View Details</a><h4>2 Bedroom Flat</h4><a class="listing-address">999 Synthetic Test Street, Glasgow</a></div>',
    [futureDetail]: detail
  };
  return collect({ get: async url => { assert.ok(Object.hasOwn(pages, url), 'Unexpected URL: ' + url); return pages[url]; }, source: { id: 'future', name: 'Synthetic Future Test', url: futureCatalogue, entries: [futureCatalogue] }, now });
}
function bravePage(body = 'Tenanted Investment', description = 'Three-bedroom semi-detached house. Comparable Sold for £999,000') {
  return '<h1 class="product_title">999 Synthetic Test Street, Glasgow, G1 1AA</h1><h2>' + body + '</h2><p>Starting bid: £72,000</p><p>Auction has not been started yet.</p><p>Start On: November 11, 2026 10:00 am</p><div class="woocommerce-product-details__short-description"><p>' + description + '</p></div>';
}
function braveRun(detail = bravePage()) {
  const pages = {
    [braveCatalogue]: '<article><a href="' + braveDetail + '">999 Synthetic Test Street, Glasgow, G1 1AA</a></article>',
    [braveDetail]: detail
  };
  return collect({ get: async url => { assert.ok(Object.hasOwn(pages, url), 'Unexpected URL: ' + url); return pages[url]; }, source: { id: 'braveheart', name: 'Synthetic Braveheart Test', url: braveCatalogue, entries: [braveCatalogue] }, now });
}

test('one targeted flat', async () => {
  const r = await futureRun(); assert.equal(r.lots.length, 1); assert.equal(r.lots[0].town, 'Glasgow'); assert.equal(r.lots[0].residential_subtype, 'Flats');
});
test('Future opening bid is not guide despite misleading document title', async () => {
  const r = await futureRun(); assert.equal(r.lots[0].guide_price, null); assert.equal(r.lots[0].opening_bid, 75000);
});
test('current bid does not become sold price', async () => { assert.equal((await futureRun()).lots[0].sold_price, null); });
test('explicit available is not inferred upcoming', async () => { assert.equal((await futureRun()).lots[0].status, 'available'); });
test('unknown remains unknown with future auction date', async () => { assert.equal((await futureRun(futurePage('Unknown'))).lots[0].status, 'unknown'); });
test('explicit sold price is retained', async () => {
  const r = await futureRun(futurePage('Sold for £120,000')); assert.equal(r.lots[0].status, 'sold'); assert.equal(r.lots[0].sold_price, 120000);
});
test('Bristol Road in Birmingham is not Bristol', async () => {
  const r = await futureRun(futurePage('Available', '999 Bristol Road, Birmingham, B1 1AA')); assert.equal(r.lots.length, 0);
});
test('Braveheart not-started future auction is upcoming', async () => { assert.equal((await braveRun()).lots[0].status, 'upcoming'); });
test('Braveheart starting bid is not guide', async () => {
  const r = await braveRun(); assert.equal(r.lots[0].guide_price, null); assert.equal(r.lots[0].opening_bid, 72000);
});
test('description comparable does not create sold price', async () => { assert.equal((await braveRun()).lots[0].sold_price, null); });
for (const [expected, heading] of [
  ['Blocks', 'Block of six flats'], ['Houses', 'Detached house'], ['Flats', 'Two bedroom flat'], ['HMO', 'HMO'],
  ['Portfolios', 'Portfolio of houses'], ['Mixed-use', 'Mixed-use shop and residential flat'], ['Development', 'Residential development site']
]) {
  test('residential subtype ' + expected, async () => {
    const r = await braveRun(bravePage(heading, '')); assert.equal(r.lots.length, 1); assert.equal(r.lots[0].residential_subtype, expected);
  });
}
test('pure commercial is counted and excluded', async () => {
  const r = await braveRun(bravePage('Commercial retail shop', '')); assert.equal(r.lots.length, 0); assert.equal(r.commercial_excluded, 1);
});

// Regression cases from the read-only audit: short parent containers must not
// let supplementary descendants leak into the current lot's facts.
test('short summary ancestor cannot turn a description comparable into sold result', async () => {
  const html = '<h1 class="product_title">999 Synthetic Test Street, Glasgow, G1 1AA</h1><div class="summary"><h2>Detached house</h2><p>Status: Available</p><div class="woocommerce-product-details__short-description">Comparable Sold for £999,000</div></div>';
  const r = await braveRun(html); assert.equal(r.lots.length, 1); assert.equal(r.lots[0].sold_price, null); assert.equal(r.lots[0].status, 'available');
});
test('short summary with supplementary sold status does not mark the current lot sold', async () => {
  const html = '<h1 class="product_title">999 Synthetic Test Street, Glasgow, G1 1AA</h1><h2>Detached house</h2><div class="summary"><div class="woocommerce-product-details__short-description">Sold for £999,000</div></div>';
  const r = await braveRun(html); assert.equal(r.lots[0].sold_price, null); assert.equal(r.lots[0].status, 'unknown');
});
test('related development heading cannot classify a garage as residential development', async () => {
  const html = '<h1 class="product_title">Garage, 999 Synthetic Test Street, Glasgow, G1 1AA</h1><h2>Garage</h2><p>Status: Available</p><section class="related products"><h2>Residential development site</h2></section>';
  const r = await braveRun(html); assert.equal(r.lots.length, 0);
});
test('verified ending date takes precedence over starting date', async () => {
  const html = '<h1 class="product_title">999 Synthetic Test Street, Glasgow, G1 1AA</h1><h2>Detached house</h2><p>Auction has not been started yet.</p><p>Start On: November 4, 2026 10:00 am</p><p>Ending On: November 9, 2026 2:00 pm</p>';
  const r = await braveRun(html); assert.equal(r.lots[0].auction_date, '2026-11-09'); assert.equal(r.lots[0].auction_start_date, '2026-11-04');
});
test('parent warning and successful-page counter contract is preserved', async () => {
  const r = await braveRun(); assert.equal(r.errors.length, 0); assert.ok(r.warnings.some(message => message.includes('no open reuse licence'))); assert.equal(r.successful_pages, 2); assert.equal(r.pages, 2);
});
