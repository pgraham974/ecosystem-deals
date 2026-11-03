/**
 * Edward Mellor catalogue archive. A lot is kept only when the catalogue says
 * "Sold at £…" and the same lot’s property page states a passing rent.
 * Sold prior with no price, guides and area rental values are ignored.
 * Crawl-delay on this host is 1 second.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'comps', 'mellor-niy.json');
const UA = 'LauritoAuctionsBot/1.0 (+https://github.com/pgrahamLC/ecosystem-deals)';
const DELAY = 1100;

const PASSING = /\b(?:currently let|currently generating|currently achieving|let at|let to|generating a rental|rental income|income of £|rent of £|tenancy|tenanted|sitting tenant|long-standing tenant|ast\b)\b/i;
const NOT_PASSING = /\b(?:potential|in the region of|rental values|scope to|scope for|asking rent|estimated|lha|could achieve|vacant|previously let|was let|if let|guide price|market rent)\b/i;

function decode(s) {
  let t = String(s || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  for (let i = 0; i < 2; i++) t = t.replace(/&amp;/g, '&');
  return t.replace(/&pound;|&#163;/gi, '£').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function get(url) {
  await sleep(DELAY);
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
function postcode(text) {
  const m = String(text).toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  return m ? m[1] + ' ' + m[2] : '';
}
function outward(pc) {
  return (String(pc).toUpperCase().match(/^[A-Z]{1,2}\d[A-Z\d]?/) || [''])[0];
}
function parentCity(pc, address) {
  const code = outward(pc);
  const n = Number((code.match(/\d+/) || [''])[0]);
  if (/^EH/.test(code)) return 'Edinburgh';
  if (/^G\d/.test(code)) return 'Glasgow';
  if (/^GL/.test(code)) return 'Cheltenham';
  if (/^BS/.test(code) || (/^BA/.test(code) && n <= 3)) return 'Bristol';
  if (/^M\d/.test(code) || /^OL/.test(code) || /^BL/.test(code) || /^WN/.test(code)) return 'Manchester';
  if (/^SK/.test(code) && n >= 1 && n <= 16) return 'Manchester';
  if (/^WA/.test(code) && n >= 1 && n <= 16) return 'Manchester';
  if (/\bManchester\b|\bSalford\b|\bStockport\b|\bBolton\b|\bBury\b|\bOldham\b|\bRochdale\b|\bWigan\b|\bAltrincham\b|\bSale\b/.test(address) && !pc) return 'Manchester';
  return '';
}
function subArea(address, city) {
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  const drop = /greater manchester|lancashire|cheshire|merseyside/i;
  const named = parts.filter(p => !drop.test(p) && !/^[A-Z]{1,2}\d/.test(p));
  const local = named.filter(p => p.toLowerCase() !== city.toLowerCase());
  return (local[local.length - 1] || named[0] || city).slice(0, 50);
}
function auctionDate(slug) {
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const m = slug.match(/(\d{1,2})?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d{4})/i);
  if (!m) return '';
  const day = (m[1] || '01').padStart(2, '0');
  return m[3] + '-' + months[m[2].toLowerCase()] + '-' + day;
}
function inWindow(iso) {
  return iso >= '2021-11-01' && iso <= '2026-11-03';
}
function rentFrom(text) {
  const annuals = [];
  const re = /£\s*([\d,]+(?:\.\d+)?)\s*(pcm|per calendar month|per month|per annum|pa\b|a year)/gi;
  let m;
  while ((m = re.exec(text))) {
    const slice = text.slice(Math.max(0, m.index - 160), m.index + m[0].length + 60);
    if (NOT_PASSING.test(slice) || !PASSING.test(slice)) continue;
    const amount = Math.round(Number(m[1].replace(/,/g, '')));
    if (!amount) continue;
    const annual = /pcm|per calendar month|per month/.test(m[2].toLowerCase()) ? amount * 12 : amount;
    if (annual < 2400 || annual > 250000) continue;
    annuals.push({ annual, quote: slice.replace(/\s+/g, ' ').trim() });
  }
  annuals.sort((a, b) => b.annual - a.annual);
  return annuals[0] || null;
}
function typeOf(text) {
  const t = text.toLowerCase();
  if (/portfolio/.test(t)) return 'portfolio';
  if (/mixed use|shop and/.test(t)) return 'mixed use';
  if (/\bhmo\b/.test(t)) return 'HMO';
  if (/block of flats|self-contained flats/.test(t)) return 'resi block';
  if (/\bflat\b|apartment|maisonette/.test(t)) return 'flat';
  if (/house|terrace|bungalow|cottage|dwelling|bedroom/.test(t)) return 'house';
  return 'house';
}
function catalogues(html) {
  const hrefs = [...html.matchAll(/href="(?:https:\/\/edwardmellor\.co\.uk)?(\/auctions\/[a-z0-9]+)\/?"/gi)].map(m => m[1].replace(/\/$/, ''));
  const uniq = [...new Set(hrefs)];
  return uniq.map(p => ({ path: p, date: auctionDate(p.split('/').pop()) })).filter(x => x.date && inWindow(x.date));
}
function lotsFrom(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/id="item_(\d+)"([\s\S]*?)(?=id="item_|\Z)/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const body = m[2];
    const price = body.match(/Sold at £([\d,]+)/);
    if (!price) continue;
    const alt = body.match(/alt="([^"]+)"/) || body.match(/alt='([^']+)'/);
    const address = (alt ? alt[1] : '').replace(/\s+/g, ' ').trim();
    const pc = postcode(address);
    const city = parentCity(pc, address);
    if (!city) continue;
    if (/unit |office|warehouse|land |garage/i.test(address) && !/flat|house|apartment/i.test(address)) continue;
    out.push({
      id: m[1],
      url: 'https://edwardmellor.co.uk/property-for-sale/' + m[1] + '/',
      address,
      postcode: pc,
      city,
      sold_price: Math.round(Number(price[1].replace(/,/g, '')))
    });
  }
  return out;
}

async function main() {
  const index = await get('https://edwardmellor.co.uk/auctions/catalogue-and-results-archive/');
  const cats = catalogues(index);
  process.stdout.write('catalogues ' + cats.length + '\n');
  const rows = [];
  const seen = new Set();
  for (const cat of cats) {
    let html = '';
    try { html = await get('https://edwardmellor.co.uk' + cat.path + '/'); }
    catch (e) { process.stdout.write('cat fail ' + cat.path + ' ' + e.message + '\n'); continue; }
    const lots = lotsFrom(html);
    process.stdout.write(cat.date + ' sold-in-area ' + lots.length + '\n');
    for (const lot of lots) {
      if (seen.has(lot.id) || lot.sold_price < 5000) continue;
      seen.add(lot.id);
      try {
        const page = decode(await get(lot.url));
        const rent = rentFrom(page);
        if (!rent) continue;
        const gross = rent.annual / lot.sold_price;
        if (!(gross > 0.025 && gross < 0.35)) continue;
        const row = {
          city: lot.city,
          sub_area: subArea(lot.address, lot.city),
          address: lot.address.slice(0, 160),
          postcode: lot.postcode,
          type: typeOf(lot.address + ' ' + page.slice(0, 2500)),
          sold_price: lot.sold_price,
          sold_date: cat.date,
          rent_pa: rent.annual,
          rent_text: rent.quote.slice(0, 220),
          rent_basis: 'passing',
          price_basis: 'sold',
          gross_yield: Math.round(gross * 10000) / 10000,
          auctioneer: 'Edward Mellor',
          url: lot.url,
          evidence: 'Edward Mellor catalogue ' + cat.path + ' states Sold at £' + lot.sold_price.toLocaleString('en-GB') + '. The property page states the passing rent. https://edwardmellor.co.uk' + cat.path + '/'
        };
        rows.push(row);
        fs.appendFileSync(OUT + 'l', JSON.stringify(row) + '\n');
        process.stdout.write('KEEP ' + row.sub_area + ' ' + row.sold_price + ' ' + row.rent_pa + ' ' + row.address.slice(0, 60) + '\n');
      } catch (e) {
        process.stdout.write('lot fail ' + lot.id + ' ' + e.message + '\n');
      }
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ retrieved: new Date().toISOString(), rows }, null, 2));
  const counts = {};
  for (const r of rows) counts[r.city] = (counts[r.city] || 0) + 1;
  process.stdout.write('WROTE ' + rows.length + ' ' + JSON.stringify(counts) + '\n');
}
main().catch(err => { console.error(err); process.exit(1); });
