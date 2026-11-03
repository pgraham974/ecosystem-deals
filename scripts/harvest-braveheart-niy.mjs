/**
 * Braveheart product pages. Keep a lot only when the page states a completed
 * price and a passing rent in Glasgow, Edinburgh or a labelled surrounding town.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'comps', 'braveheart-niy.json');
const UA = 'LauritoAuctionsBot/1.0 (+https://github.com/pgrahamLC/ecosystem-deals)';

function decode(s) {
  let t = String(s || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  for (let i = 0; i < 2; i++) t = t.replace(/&amp;/g, '&');
  return t.replace(/&pound;|&#163;/gi, '£').replace(/&#8211;/g, '-').replace(/\s+/g, ' ').trim();
}
function postcode(text) {
  const m = String(text).toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  return m ? m[1] + ' ' + m[2] : '';
}
function cityOf(pc, text) {
  const code = (pc.match(/^[A-Z]{1,2}\d+/) || [''])[0];
  const n = code ? Number(code.replace(/^[A-Z]+/, '')) : null;
  if (/^EH/.test(code)) return 'Edinburgh';
  if (/^G\d/.test(code)) return 'Glasgow';
  if (/^ML/.test(code) && n != null && n <= 12) return 'Glasgow';
  if (/^PA/.test(code) && n != null && n <= 19) return 'Glasgow';
  if (/\bEdinburgh\b/.test(text) && !/\baccess to Edinburgh\b/i.test(text.slice(0, 200))) return 'Edinburgh';
  if (/\bGlasgow\b/.test(text.split(',')[0] || '')) return 'Glasgow';
  return '';
}
const PASSING = /\b(?:currently let|currently paying|paying £|let at|tenant paying|tenants paying|rental income of|generating £|income of £)\b/i;
const NOT_PASSING = /\b(?:potential|previously let|was let|vacant|scope to|lha|estimated|guide)\b/i;

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function main() {
  const xml = await get('https://braveheartauctions.co.uk/product-sitemap.xml');
  const urls = [...xml.matchAll(/<loc>(https:\/\/braveheartauctions.co.uk\/product\/[^<]+)<\/loc>/g)].map(m => m[1]);
  const rows = [];
  process.stdout.write('products ' + urls.length + '\n');
  for (const url of urls) {
    try {
      const text = decode(await get(url));
      const sold = text.match(/Sold for\s*£\s*([\d,]+)/i) || text.match(/sold by auction for\s*£\s*([\d,]+)/i);
      if (!sold) continue;
      const price = Math.round(Number(sold[1].replace(/,/g, '')));
      if (price < 5000) continue;
      const pc = postcode(text.slice(0, 500) + ' ' + url);
      const city = cityOf(pc, text.slice(0, 400));
      if (!city) continue;
      const at = text.slice(Math.max(0, text.toLowerCase().indexOf('£') - 40));
      const window = text.slice(0, 3500);
      const rentM = window.match(/£\s*([\d,]+)\s*(?:per month|pcm|per calendar month)/i) || window.match(/£\s*([\d,]+)\s*(?:per year|per annum|pa)/i);
      if (!rentM) continue;
      const slice = window.slice(Math.max(0, rentM.index - 120), rentM.index + 80);
      if (NOT_PASSING.test(slice) || !PASSING.test(slice)) continue;
      const annual = /per year|per annum|\bpa\b/i.test(rentM[0]) && !/per month|pcm/i.test(rentM[0])
        ? Math.round(Number(rentM[1].replace(/,/g, '')))
        : Math.round(Number(rentM[1].replace(/,/g, '')) * 12);
      if (annual < 2400) continue;
      const gross = annual / price;
      if (!(gross > 0.025 && gross < 0.35)) continue;
      rows.push({
        city,
        sub_area: (text.match(/([A-Z][a-z]+(?: [A-Z][a-z]+)?),\s*(?:G|EH|ML|PA)/) || [, city])[1],
        address: (text.match(/\d[^£]{6,120}?\b(?:G|EH|ML|PA)\d[A-Z\d]?\s*\d[A-Z]{2}/) || [url])[0].slice(0, 140),
        postcode: pc,
        type: /hmo/i.test(window) ? 'HMO' : /flat|apartment/i.test(window) ? 'flat' : 'house',
        sold_price: price,
        sold_date: '',
        rent_pa: annual,
        rent_text: slice.slice(0, 200),
        rent_basis: 'passing',
        price_basis: 'sold',
        gross_yield: Math.round(gross * 10000) / 10000,
        auctioneer: 'Braveheart Auctions',
        url,
        evidence: 'Braveheart product page states a sold price and a current rent. ' + url
      });
      process.stdout.write('KEEP ' + city + ' ' + price + ' ' + annual + '\n');
    } catch (e) {
      process.stdout.write('fail ' + e.message + '\n');
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ retrieved: new Date().toISOString(), rows }, null, 2));
  process.stdout.write('WROTE ' + rows.length + '\n');
}
main().catch(err => { console.error(err); process.exit(1); });
