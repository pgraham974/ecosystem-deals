/**
 * Read public auction result tables. Keep a lot only when the same row
 * states a completed sold price and a passing rent. Nothing is guessed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'comps', 'harvested-niy.json');
const UA = 'LauritoAuctionCatalogue/1.0 (+https://pgrahamlc.github.io/ecosystem-deals/; public catalogue research)';

const PASSING = /\b(?:currently let|let at|let subject to|subject to an AST|produces? £|producing £|income of £|passing rent|tenant(?:s)? (?:is |are )?paying|reserved rent|annual rent of £|rent of £|rent reserved)\b/i;
const NOT_PASSING = /\b(?:potential|in the region of|scope for|asking rent|estimated|lha|could achieve|appraisal|erv|if purchased)\b/i;

function decode(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&pound;|&#163;/g, '£')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function money(text) {
  const m = String(text || '').replace(/,/g, '').match(/£\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  return n > 1000 ? n : null;
}

function rentPa(text) {
  const pcm = text.replace(/,/g, '').match(/£\s*([0-9]+(?:\.[0-9]+)?)\s*pcm/i);
  if (pcm) return Math.round(Number(pcm[1]) * 12);
  const pa = text.replace(/,/g, '').match(/£\s*([0-9]+(?:\.[0-9]+)?)\s*(?:per annum|pa\b|p\.a)/i);
  if (pa) return Math.round(Number(pa[1]));
  return null;
}

function areaOf(text) {
  const raw = text.replace(/Greater Manchester/ig, ' ');
  if (/\bGlasgow\b/i.test(raw)) return 'Glasgow';
  if (/\bEdinburgh\b/i.test(raw)) return 'Edinburgh';
  if (/\bCheltenham\b|\bGloucester\b|\bStroud\b|\bCirencester\b|\bTewkesbury\b|\bGL\d/i.test(raw)) return 'Cheltenham';
  if (/\bBristol\b|\bBS(?:[1-9]|1[0-6])\b/i.test(raw)) return 'Bristol';
  if (/\bManchester\b/i.test(raw)) return 'Manchester';
  return '';
}

function typeOf(text) {
  const t = text.toLowerCase();
  if (/portfolio of \d+|(\d+) self contained flats|block of flats/.test(t)) return 'resi block';
  if (/\bhmo\b|house in multiple/.test(t)) return 'HMO';
  if (/shop \+|retail \+|mixed use|upper parts|flat above/.test(t)) return 'mixed use';
  if (/\bflat\b|apartment|maisonette|studio/.test(t)) return 'flat';
  if (/house|terrace|semi-detached|bungalow|cottage/.test(t)) return 'house';
  return 'residential';
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

function parsePugh(html, pageUrl) {
  const out = [];
  const trs = [...html.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => m[0]);
  for (const tr of trs) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => decode(m[1]));
    if (cells.length < 4) continue;
    const desc = cells[1];
    const status = cells[2];
    const soldText = cells[3];
    if (!/^Sold$/i.test(status) && !/^Sold at auction$/i.test(status)) continue;
    const sold = money(soldText);
    if (!sold) continue;
    if (!PASSING.test(desc) || NOT_PASSING.test(desc)) continue;
    const rent = rentPa(desc);
    if (!rent) continue;
    const city = areaOf(desc);
    if (!city) continue;
    const href = (tr.match(/href="(https:\/\/www\.pugh-auctions\.com\/property\/[^"]+)"/) || [])[1] || pageUrl;
    const address = desc.split(/ A | An | OF /)[0].replace(/^\d+\s*/, '').trim();
    out.push({
      city,
      address: address.slice(0, 140),
      postcode: (desc.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/) || [''])[0],
      type: typeOf(desc),
      sold_price: sold,
      sold_date: '',
      rent_pa: rent,
      rent_text: desc.slice(0, 240),
      rent_basis: 'passing',
      price_basis: 'sold',
      auctioneer: 'Pugh Auctions',
      url: href,
      evidence: 'Pugh previous-auction results table. Status Sold with a price in the sold column, and the same description states a current let. ' + pageUrl
    });
  }
  return out;
}

async function pughPages() {
  const urls = new Set();
  for (let page = 1; page <= 12; page++) {
    const html = await get('https://www.pugh-auctions.com/our-online-auctions/previous-auction-results?page=' + page);
    for (const m of html.matchAll(/href="(https:\/\/www\.pugh-auctions\.com\/previous-auction-results\/[^"?]+)"/g)) urls.add(m[1]);
    process.stdout.write('index ' + page + ' urls ' + urls.size + '\n');
  }
  return [...urls];
}

async function main() {
  const found = [];
  const pages = await pughPages();
  let i = 0;
  for (const url of pages) {
    i++;
    try {
      const html = await get(url);
      const rows = parsePugh(html, url);
      found.push(...rows);
      process.stdout.write(i + '/' + pages.length + ' +' + rows.length + ' total ' + found.length + '\n');
    } catch (e) {
      process.stdout.write(i + ' fail ' + e.message + '\n');
    }
    if (i % 8 === 0) fs.writeFileSync(OUT, JSON.stringify({ retrieved: new Date().toISOString(), rows: found }, null, 2));
  }
  const seen = new Set();
  const rows = found.filter(r => {
    const k = (r.postcode + '|' + r.address).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  fs.writeFileSync(OUT, JSON.stringify({ retrieved: new Date().toISOString(), rows }, null, 2));
  const by = {};
  for (const r of rows) by[r.city] = (by[r.city] || 0) + 1;
  console.log(JSON.stringify(by));
}

main().catch(e => { console.error(e); process.exit(1); });
