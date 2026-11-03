/**
 * Pugh result tables often truncate the rent. Keep a lot only when the results
 * row shows Sold at auction with a price, the address is in one of the five
 * areas, and the property page states a current passing rent.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'comps', 'pugh-niy.json');
const UA = 'LauritoAuctionsBot/1.0 (+https://github.com/pgrahamLC/ecosystem-deals)';

function decode(s) {
  let t = String(s || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  for (let i = 0; i < 2; i++) t = t.replace(/&amp;/g, '&');
  return t.replace(/&pound;|&#163;/gi, '£').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function postcode(text) {
  const m = String(text).toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  return m ? m[1] + ' ' + m[2] : '';
}
function cityOf(address, pc) {
  const code = String(pc || '').toUpperCase();
  if (/^EH/.test(code)) return 'Edinburgh';
  if (/^GL/.test(code)) return 'Cheltenham';
  if (/^G\d/.test(code)) return 'Glasgow';
  if (/^BS/.test(code)) return 'Bristol';
  if (/^M\d/.test(code)) return 'Manchester';
  if (/\bEdinburgh\b/i.test(address)) return 'Edinburgh';
  if (/\bGlasgow\b/i.test(address)) return 'Glasgow';
  if (/\bBristol\b/i.test(address)) return 'Bristol';
  if (/\bManchester\b/i.test(address)) return 'Manchester';
  if (/\bCheltenham\b|\bGloucester\b/i.test(address)) return 'Cheltenham';
  return '';
}
const PASSING = /\b(?:currently let|currently achieving|currently generating|currently producing|let at|let for|fully let|producing £|produces £|income of £|rental income of|generating an income|subject to an AST|\bAST\b|tenants? in situ|long-standing tenant)\b/i;
const NOT_PASSING = /\b(?:potential|in the region of|around £|scope for|asking rent|estimated|lha|could achieve|appraisal|erv|vacant|previously let|was let|if let|if renting|per room|historically|most recently|guide price)\b/i;

function moneyToken(raw) {
  const n = Math.round(Number(String(raw).replace(/,/g, '')));
  return n > 0 ? n : null;
}
function rentFrom(text) {
  const annuals = [];
  const re = /£\s*([\d,]+(?:\.\d+)?)\s*(pcm|per calendar month|per month|per annum|pa\b|p\.a\.?|a year)/gi;
  let m;
  while ((m = re.exec(text))) {
    const slice = text.slice(Math.max(0, m.index - 180), m.index + m[0].length + 80);
    const statedTotal = /\btotal\b/i.test(slice);
    if ((NOT_PASSING.test(slice) && !statedTotal) || (!PASSING.test(slice) && !statedTotal)) continue;
    if (/per room|each room/i.test(slice) && !statedTotal) continue;
    const amount = moneyToken(m[1]);
    if (!amount) continue;
    const annual = /pcm|per calendar month|per month/.test(m[2].toLowerCase()) ? amount * 12 : amount;
    if (annual < 1200 || annual > 500000) continue;
    annuals.push({ annual, quote: slice.replace(/\s+/g, ' ').trim() });
  }
  const totals = annuals.filter(a => /\btotal\b/i.test(a.quote));
  const pool = totals.length ? totals : annuals;
  pool.sort((a, b) => b.annual - a.annual);
  return pool[0] || null;
}
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(22000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
async function pool(items, limit, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) await worker(items[i++]);
  }));
}

async function main() {
  const urls = new Set();
  for (let page = 1; page <= 15; page++) {
    const html = await get('https://www.pugh-auctions.com/our-online-auctions/previous-auction-results?page=' + page);
    const found = [...html.matchAll(/href="(https:\/\/www\.pugh-auctions\.com\/previous-auction-results\/[^"?]+)"/g)].map(m => m[1]);
    found.forEach(u => urls.add(u));
    process.stdout.write('index ' + page + ' ' + urls.size + '\n');
    if (!found.length) break;
  }
  const seeds = [];
  await pool([...urls], 4, async (url) => {
    try {
      const html = await get(url);
      const trs = [...html.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => m[0]);
      for (const tr of trs) {
        const text = decode(tr);
        if (!/Sold at auction/i.test(text)) continue;
        if (/Sold Prior|Sold Post|Withdrawn/i.test(text)) continue;
        const sold = (text.match(/£\s*([\d,]+)/) || [])[1];
        const price = sold ? moneyToken(sold) : null;
        if (!price || price < 5000) continue;
        const href = (tr.match(/href="(https:\/\/www\.pugh-auctions\.com\/property\/[^"]+)"/) || [])[1];
        const address = (text.match(/\b\d[^|]{6,140}?\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/) || [''])[0];
        const pc = postcode(address || text);
        const city = cityOf(address || text.slice(0, 240), pc);
        if (!city || !href) continue;
        seeds.push({ href, address: address || text.slice(0, 140), pc, city, price, page: url });
      }
    } catch (e) {
      process.stdout.write('page fail ' + e.message + '\n');
    }
  });
  process.stdout.write('seeds ' + seeds.length + '\n');
  const rows = [];
  const seen = new Set();
  await pool(seeds, 4, async (seed) => {
    if (seen.has(seed.href)) return;
    seen.add(seed.href);
    try {
      const text = decode(await get(seed.href));
      const rent = rentFrom(text);
      if (!rent) return;
      if (/commercial investment|restaurant|public house|ground rent/i.test(rent.quote) && !/flat|hmo|house|apartment|residential/i.test(rent.quote)) return;
      const gross = rent.annual / seed.price;
      if (!(gross > 0.02 && gross < 0.4)) return;
      const address = (text.match(/([A-Z0-9][^£]{8,140}?\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/) || [seed.address])[0].replace(/\s+/g, ' ').trim();
      rows.push({
        city: seed.city,
        address: address.slice(0, 160),
        postcode: postcode(address) || seed.pc,
        type: /hmo/i.test(text.slice(0, 500)) ? 'HMO' : /flat|apartment/i.test(text.slice(0, 400)) ? 'flat' : /block|portfolio|flats/i.test(text.slice(0, 400)) ? 'resi block' : 'house',
        sold_price: seed.price,
        sold_date: '',
        rent_pa: rent.annual,
        rent_text: rent.quote.slice(0, 220),
        rent_basis: 'passing',
        price_basis: 'sold',
        gross_yield: Math.round(gross * 10000) / 10000,
        auctioneer: 'Pugh Auctions',
        url: seed.href,
        evidence: 'Pugh results row status Sold at auction with a price, and the property page states the current rent. ' + seed.page
      });
      process.stdout.write('KEEP ' + seed.city + ' ' + seed.price + ' ' + rent.annual + ' ' + address.slice(0, 70) + '\n');
    } catch (e) {
      process.stdout.write('lot fail ' + e.message + '\n');
    }
  });
  fs.writeFileSync(OUT, JSON.stringify({ retrieved: new Date().toISOString(), rows }, null, 2));
  const counts = {};
  for (const r of rows) counts[r.city] = (counts[r.city] || 0) + 1;
  process.stdout.write('WROTE ' + rows.length + ' ' + JSON.stringify(counts) + '\n');
}
main().catch(err => { console.error(err); process.exit(1); });
