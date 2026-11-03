/**
 * Walk the public Pugh property sitemap. Keep a lot only when that same page
 * states a completed sold price and a passing rent, and the postcode sits in
 * one of the five areas or a named surrounding town. Guide prices are ignored.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'comps', 'pugh-area-niy.json');
const LOG = path.join(ROOT, 'comps', 'pugh-area-niy.jsonl');
const SITEMAP = '/tmp/pugh-sm.xml';
const UA = 'LauritoAuctionsBot/1.0 (+https://github.com/pgrahamLC/ecosystem-deals)';

const PASSING = /\b(?:currently let|currently achieving|currently generating|currently producing|let at|let for|fully let|producing £|produces £|income of £|rental income of|rent of £|generating an income|assured shorthold|\bAST\b|tenants? in situ|long-standing tenant|occupied producing)\b/i;
const NOT_PASSING = /\b(?:potential|in the region of|around £|scope for|asking rent|estimated|lha|could achieve|appraisal|\berv\b|rental value|could be let|to let|vacant possession|previously let|was let|if let|if renting|per room|historically|most recently|guide price|advertised for)\b/i;

function decode(s) {
  let t = String(s || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (let i = 0; i < 2; i++) t = t.replace(/&amp;/g, '&');
  return t.replace(/&pound;|&#163;/gi, '£').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function postcode(text) {
  const m = String(text).toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  return m ? m[1] + ' ' + m[2] : '';
}

function outward(pc) {
  return (String(pc).toUpperCase().match(/^[A-Z]{1,2}\d[A-Z\d]?/) || [''])[0];
}

function districtNumber(code) {
  const m = String(code).match(/^[A-Z]{1,2}(\d+)/);
  return m ? Number(m[1]) : null;
}

function parentCity(pc) {
  const code = outward(pc);
  const n = districtNumber(code);
  if (/^EH/.test(code)) return 'Edinburgh';
  if (/^KY/.test(code) && n != null && n <= 12) return 'Edinburgh';
  if (/^FK/.test(code) && n != null && n <= 4) return 'Edinburgh';
  if (/^G\d/.test(code)) return 'Glasgow';
  if (/^ML/.test(code) && n != null && n <= 12) return 'Glasgow';
  if (/^PA/.test(code) && n != null && n >= 1 && n <= 19) return 'Glasgow';
  if (/^GL/.test(code)) return 'Cheltenham';
  if (/^BS/.test(code)) return 'Bristol';
  if (/^BA/.test(code) && n != null && n <= 3) return 'Bristol';
  if (/^M\d/.test(code)) return 'Manchester';
  if (/^OL/.test(code) || /^BL/.test(code) || /^WN/.test(code)) return 'Manchester';
  if (/^SK/.test(code) && n != null && n >= 1 && n <= 16) return 'Manchester';
  if (/^WA/.test(code) && n != null && n >= 1 && n <= 16) return 'Manchester';
  return '';
}

function subArea(address, city) {
  const parts = String(address).split(',').map(s => s.trim()).filter(Boolean);
  const drop = /^(greater manchester|south yorkshire|west yorkshire|lancashire|cheshire|gloucestershire|south gloucestershire|north somerset|bath and north east somerset|city of edinburgh|midlothian|east lothian|west lothian|lanarkshire|south lanarkshire|north lanarkshire|renfrewshire|east renfrewshire|inverclyde|fife|scotland|england)$/i;
  const named = parts.filter(p => !drop.test(p) && !/^[A-Z]{1,2}\d/.test(p) && p.length > 2);
  const local = named.filter(p => p.toLowerCase() !== city.toLowerCase());
  return (local[local.length - 1] || named[named.length - 1] || city).slice(0, 60);
}

function moneyToken(raw) {
  const n = Math.round(Number(String(raw).replace(/,/g, '')));
  return n > 0 ? n : null;
}

function rentFrom(text) {
  const annuals = [];
  const re = /£\s*([\d,]+(?:\.\d+)?)\s*(pcm|per calendar month|per month|per annum|pa\b|p\.a\.?|a year)/gi;
  let m;
  while ((m = re.exec(text))) {
    const slice = text.slice(Math.max(0, m.index - 180), m.index + m[0].length + 70);
    const statedTotal = /\btotal\b/i.test(slice);
    if ((NOT_PASSING.test(slice) && !statedTotal) || (!PASSING.test(slice) && !statedTotal)) continue;
    if (/per room|each room/i.test(slice) && !statedTotal) continue;
    const amount = moneyToken(m[1]);
    if (!amount) continue;
    const annual = /pcm|per calendar month|per month/.test(m[2].toLowerCase()) ? amount * 12 : amount;
    if (annual < 2400 || annual > 400000) continue;
    annuals.push({ annual, quote: slice.replace(/\s+/g, ' ').trim() });
  }
  const totals = annuals.filter(a => /\btotal\b/i.test(a.quote));
  const pool = (totals.length ? totals : annuals).slice().sort((a, b) => b.annual - a.annual);
  return pool[0] || null;
}

function soldFrom(title, body) {
  const titled = title.match(/Sold Price:\s*£\s*([\d,]+)/i);
  if (titled) {
    const n = moneyToken(titled[1]);
    if (n >= 5000) return n;
  }
  const cut = body.split(/you may also like|view property sold at auction/i)[0];
  const inline = cut.match(/Sold for\s*£\s*([\d,]+)/i);
  if (inline) {
    const n = moneyToken(inline[1]);
    if (n >= 5000) return n;
  }
  return null;
}

function addressFrom(title, body) {
  const titled = title.match(/Sold Price:\s*£\s*[\d,]+\s*,\s*(.+?)(?:\s*\|\s*Pugh|\s*,\s*\d{4,}\s*\|)/i);
  if (titled) return titled[1].replace(/\s+/g, ' ').trim();
  const h = body.match(/\b(?:Flat|Apartment|Studio|\d)[^£]{6,160}?\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/);
  return h ? h[0].replace(/\s+/g, ' ').trim() : '';
}

function soldDate(body) {
  const m = body.match(/Auction Ends:\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})/i) || body.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (!m) return '';
  const y = Number(m[3]);
  if (y < 2021 || y > 2026) return '';
  return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
}

function typeOf(text) {
  const t = text.toLowerCase();
  if (/portfolio of \d+|portfolio comprising/.test(t)) return 'portfolio';
  if (/mixed use|shop and flat|retail and flat|upper floors/.test(t)) return 'mixed use';
  if (/\bhmo\b|house in multiple|licensed hmo/.test(t)) return 'HMO';
  if (/block of flats|(\d+)\s+self.contained flats|flats 1/.test(t)) return 'resi block';
  if (/\bflat\b|apartment|maisonette|studio/.test(t)) return 'flat';
  if (/house|terrace|semi-detached|bungalow|cottage|dwelling/.test(t)) return 'house';
  return '';
}

function focus(title, body) {
  const cut = body.split(/you may also like|view property sold at auction/i)[0];
  const at = cut.search(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/);
  const from = at >= 0 ? cut.slice(at, at + 2800) : cut.slice(-2800);
  return (title + ' ' + from).replace(/\s+/g, ' ');
}

function residential(text) {
  if (/\b(land adj|parcel of land|garage site|ground rent only|woodland|grazing land|development plot)\b/i.test(text.slice(0, 500))) return false;
  return /\b(flat|apartment|house|hmo|maisonette|studio|dwelling|bungalow|cottage|terrace|residential|bedroom)\b/i.test(text);
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function pool(items, limit, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }));
}

function urls() {
  const xml = fs.readFileSync(SITEMAP, 'utf8');
  return [...xml.matchAll(/<loc>(https:\/\/www\.pugh-auctions\.com\/property\/[^<]+)<\/loc>/g)].map(m => m[1]);
}

async function main() {
  const list = urls();
  const rows = [];
  const seen = new Set();
  let scanned = 0;
  let soldArea = 0;
  fs.writeFileSync(LOG, '');
  process.stdout.write('properties ' + list.length + '\n');
  await pool(list, 6, async (url) => {
    try {
      const html = await get(url);
      const title = decode((html.match(/<title>([^<]+)/i) || ['', ''])[1]);
      const body = decode(html);
      const sold = soldFrom(title, body);
      const address = addressFrom(title, body.split(/you may also like/i)[0]);
      const pc = postcode(address + ' ' + title) || postcode(body.slice(0, 2500));
      const city = parentCity(pc);
      if (sold && city) {
        soldArea += 1;
        const own = focus(title, body);
        if (residential(own)) {
          const rent = rentFrom(own);
          if (!rent && soldArea <= 40) {
            const snippet = (own.match(/.{0,80}£\s*[\d,]+.{0,40}/) || [''])[0].replace(/\s+/g, ' ');
            fs.appendFileSync('/tmp/niy-pugh-miss.txt', city + ' ' + sold + ' ' + (address || title).slice(0, 90) + ' || ' + snippet.slice(0, 140) + '\n');
          }
          if (rent && !(/commercial investment|restaurant|public house|ground rent/i.test(rent.quote) && !/flat|hmo|house|apartment|residential/i.test(rent.quote))) {
            const gross = rent.annual / sold;
            if (gross > 0.025 && gross < 0.35 && !seen.has(pc + '|' + sold)) {
              seen.add(pc + '|' + sold);
              const row = {
                city,
                sub_area: subArea(address || title, city),
                address: (address || title).slice(0, 160),
                postcode: pc,
                type: typeOf(title + ' ' + own.slice(0, 700)) || 'residential',
                sold_price: sold,
                sold_date: soldDate(body),
                rent_pa: rent.annual,
                rent_text: rent.quote.slice(0, 220),
                rent_basis: 'passing',
                price_basis: 'sold',
                gross_yield: Math.round(gross * 10000) / 10000,
                auctioneer: 'Pugh Auctions',
                url,
                evidence: 'Pugh property page. Completed sold price and the passing rent are both printed on this lot. ' + url
              };
              rows.push(row);
              fs.appendFileSync(LOG, JSON.stringify(row) + '\n');
              process.stdout.write('KEEP ' + city + ' [' + row.sub_area + '] ' + sold + ' ' + rent.annual + ' ' + row.address.slice(0, 70) + '\n');
            }
          }
        }
      }
    } catch (e) {
      if (!/HTTP 404/.test(e.message)) process.stdout.write('fail ' + url.split('/').pop() + ' ' + e.message + '\n');
    }
    scanned += 1;
    if (scanned % 100 === 0) {
      const line = 'scan ' + scanned + '/' + list.length + ' sold-in-area ' + soldArea + ' kept ' + rows.length + '\n';
      fs.appendFileSync('/tmp/niy-pugh-progress.txt', line);
      process.stdout.write(line);
    }
  });
  const counts = {};
  for (const r of rows) counts[r.city] = (counts[r.city] || 0) + 1;
  fs.writeFileSync(OUT, JSON.stringify({ retrieved: new Date().toISOString(), rows }, null, 2));
  process.stdout.write('WROTE ' + rows.length + ' ' + JSON.stringify(counts) + '\n');
}

main().catch(err => { console.error(err); process.exit(1); });
