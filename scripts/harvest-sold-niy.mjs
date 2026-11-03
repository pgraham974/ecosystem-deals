/**
 * Collect sold residential lots that print both a completed price and a passing rent.
 * Guide prices, ERV, LHA and “in the region of” are dropped. Nothing is estimated.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'comps', 'harvested-niy.json');
const UA = 'LauritoAuctionsBot/1.0 (+https://github.com/pgrahamLC/ecosystem-deals)';

const PASSING = /\b(?:currently let|currently achieving|currently generating|currently producing|currently occupied|let at|let for|let on an|fully let|tenanted at|producing £|produces £|income of £|rental income of|passing rent|generating £|generating an income|assured shorthold|subject to an AST|\bAST\b|occupied producing|tenants? in situ|sitting tenant|long-standing tenant|has been let to)\b/i;
const NOT_PASSING = /\b(?:potential|in the region of|around £|scope for|asking rent|estimated|lha|could achieve|appraisal|\berv\b|rental value|could be let|to let|vacant|previously let|was let|once let|if let|if renting|guide price|per room|historically|most recently|advertised for)\b/i;

function decode(s) {
  let t = String(s || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (let i = 0; i < 2; i++) t = t.replace(/&amp;/g, '&');
  return t
    .replace(/&pound;|&#163;/gi, '£')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (/^BA[1-3]/.test(code)) return 'Bristol';
  if (/^M\d/.test(code)) return 'Manchester';
  const blob = address || '';
  if (/\bEdinburgh\b/i.test(blob)) return 'Edinburgh';
  if (/\bGlasgow\b/i.test(blob)) return 'Glasgow';
  if (/\bBristol\b/i.test(blob)) return 'Bristol';
  if (/\bManchester\b/i.test(blob)) return 'Manchester';
  if (/\bCheltenham\b|\bGloucester\b|\bStroud\b|\bCirencester\b|\bTewkesbury\b|\bColeford\b/i.test(blob)) return 'Cheltenham';
  return '';
}

function typeOf(text) {
  const t = text.toLowerCase();
  if (/portfolio/.test(t)) return 'portfolio';
  if (/mixed use|mixed-use|retail unit \+|shop and|hmo \+ | \+ hmo|retail \+/.test(t)) return 'mixed use';
  if (/\bhmo\b|house in multiple|licensed hmo|student hmo/.test(t)) return 'HMO';
  if (/block of flats|block of apartments|purpose built block|(\d+)\s*(x\s*)?(self contained )?(flats|apartments)/.test(t)) return 'resi block';
  if (/\bflat\b|apartment|maisonette|studio/.test(t)) return 'flat';
  if (/house|terrace|semi-detached|bungalow|cottage|dwelling/.test(t)) return 'house';
  return 'residential';
}

function commercialOnly(text) {
  const t = text.toLowerCase();
  if (/\b(hmo|flat|apartment|house|maisonette|studio|dwelling|residential)\b/.test(t)) return false;
  return /\b(restaurant|public house|\bpub\b|nightclub|office|retail unit|shop\b|industrial|warehouse|garage|ground rent)\b/.test(t);
}

function moneyToken(raw) {
  const n = Math.round(Number(String(raw).replace(/,/g, '')));
  return n > 0 ? n : null;
}

function soldPrice(text) {
  const patterns = [
    /sold(?:\s+[a-z]+){0,3}\s*@\s*(?:auction\s*)?£\s*([\d,]+(?:\.\d+)?)\s*(m|million)?/i,
    /sold\s+for\s*:?\s*£\s*([\d,]+(?:\.\d+)?)\s*(m|million)?/i,
    /sold\s+£\s*([\d,]+(?:\.\d+)?)\s*(m|million)?/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    let n = moneyToken(m[1]);
    if (m[2] && n && n < 1000) n = Math.round(n * 1000000);
    if (n && n >= 5000) return n;
  }
  return null;
}

function rentFrom(text) {
  const windows = [];
  const re = /£\s*([\d,]+(?:\.\d+)?)\s*(pcm|per calendar month|per month|per annum|pa\b|p\.a\.?|a year)/gi;
  let m;
  while ((m = re.exec(text))) {
    const start = Math.max(0, m.index - 160);
    const slice = text.slice(start, m.index + m[0].length + 80);
    windows.push({ slice, amount: moneyToken(m[1]), unit: m[2].toLowerCase() });
  }
  const annuals = [];
  for (const w of windows) {
    if (!w.amount) continue;
    const statedTotal = /\btotal\b/i.test(w.slice);
    if (NOT_PASSING.test(w.slice) && !statedTotal) continue;
    if (!PASSING.test(w.slice) && !statedTotal) continue;
    if (/per room|each room|per bedroom/i.test(w.slice) && !/total/i.test(w.slice)) continue;
    const annual = /pcm|per calendar month|per month/.test(w.unit) ? w.amount * 12 : w.amount;
    if (annual < 1200 || annual > 500000) continue;
    annuals.push({ annual, quote: w.slice.replace(/\s+/g, ' ').trim() });
  }
  if (!annuals.length) return null;
  const totals = annuals.filter(a => /\btotal\b/i.test(a.quote));
  const pool = totals.length ? totals : annuals;
  pool.sort((a, b) => b.annual - a.annual);
  return pool[0];
}

function soldDate(text) {
  const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
  const hits = [];
  const re = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const iso = m[3] + '-' + months[m[2].toLowerCase()] + '-' + m[1].padStart(2, '0');
    const near = text.slice(Math.max(0, m.index - 90), m.index + 40);
    if (/auction|sold/i.test(near) && Number(m[3]) >= 2020) hits.push(iso);
  }
  return hits[0] || '';
}

function addressOf(text, fallback) {
  const m = text.match(/ADDRESS\s*\|\s*(.+?)\s+Lot Number/i);
  if (m) return m[1].replace(/\s+/g, ' ').trim().slice(0, 160);
  const h = text.match(/Lot\s+\d+\s+(.{8,140}?)\s+Sold\s*@/i);
  if (h && !/menu|call:/i.test(h[1])) return h[1].replace(/\s+/g, ' ').trim().slice(0, 160);
  if (fallback && postcode(fallback)) return fallback.slice(0, 160);
  return (fallback || '').slice(0, 160);
}

function rowFrom(text, meta) {
  if (/withdrawn|sold prior|sold post/i.test(text) && !/sold\s*@\s*(?:auction\s*)?£\s*[\d,]+|sold\s+for\s*:?\s*£\s*[\d,]+/i.test(text)) return null;
  const sold = soldPrice(text);
  if (!sold) return null;
  const address = addressOf(text, meta.address || '');
  const pc = postcode(address) || postcode(meta.address || '') || postcode(text.slice(0, 1800));
  const city = cityOf((address || '') + ' ' + (meta.address || ''), pc);
  if (!city) return null;
  if (commercialOnly(text.slice(0, 1800))) return null;
  const rent = rentFrom(text);
  if (!rent) return null;
  if (/commercial (?:element|investment|unit)|retail unit|ground rent/i.test(rent.quote) && !/flat|hmo|apartment|maisonette|residential/i.test(rent.quote)) return null;
  const gross = rent.annual / sold;
  if (!(gross > 0.02 && gross < 0.4)) return null;
  const type = typeOf((meta.hint || '') + ' ' + text.slice(0, 1200));
  return {
    city,
    address,
    postcode: pc,
    type,
    sold_price: sold,
    sold_date: soldDate(text),
    rent_pa: rent.annual,
    rent_text: rent.quote.slice(0, 220),
    rent_basis: 'passing',
    price_basis: 'sold',
    gross_yield: Math.round(gross * 10000) / 10000,
    auctioneer: meta.auctioneer,
    url: meta.url,
    evidence: meta.evidence
  };
}

async function get(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(22000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return { html: await r.text(), finalUrl: r.url || url };
}

async function pool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

function hollisUrls() {
  const xml = fs.readFileSync('/tmp/hollis-sitemap.xml', 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u =>
    /\/property-details\//.test(u) && /\/(bristol-city|gloucestershire|south-gloucestershire)\//.test(u)
  );
}

function parseAhRows(html) {
  const rows = [];
  const trs = [...html.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => m[0]);
  for (const tr of trs) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => decode(m[1]));
    if (cells.length < 6) continue;
    const href = (tr.match(/href="(https:\/\/online\.auctionhouse\.co\.uk\/lot\/redirect\/\d+)"/) || [])[1];
    if (!href) continue;
    const address = cells[1];
    const ended = cells[3];
    const result = cells[5];
    if (!/sold for/i.test(result)) continue;
    const sold = soldPrice(result);
    if (!sold) continue;
    const pc = postcode(address);
    if (!cityOf(address, pc)) continue;
    rows.push({ href, address, ended, sold });
  }
  return rows;
}

async function auctionHouse() {
  const branches = ['manchester', 'southwest', 'scotland'];
  const seeds = [];
  for (const branch of branches) {
    for (let page = 1; page <= 6; page++) {
      const url = 'https://www.auctionhouse.co.uk/' + branch + '/auction/past-auctions?page=' + page;
      try {
        const { html } = await get(url);
        const found = parseAhRows(html);
        process.stdout.write('AH ' + branch + ' p' + page + ' sold-in-area ' + found.length + '\n');
        if (!found.length && page > 1) break;
        seeds.push(...found.map(r => Object.assign(r, { branch })));
      } catch (e) {
        process.stdout.write('AH ' + branch + ' p' + page + ' ' + e.message + '\n');
        break;
      }
    }
  }
  return seeds;
}

async function main() {
  if (process.argv[2] === '--one') {
    const { html, finalUrl } = await get(process.argv[3]);
    console.log(JSON.stringify(rowFrom(decode(html), { url: finalUrl, auctioneer: 'test', evidence: 'test', address: '' }), null, 2));
    return;
  }
  const rows = [];
  const seen = new Set();
  function add(row) {
    if (!row) return;
    const key = row.url.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
    process.stdout.write('KEEP ' + row.city + ' ' + row.sold_price + ' ' + row.rent_pa + ' ' + row.address.slice(0, 70) + '\n');
  }

  const urls = hollisUrls();
  process.stdout.write('hollis urls ' + urls.length + '\n');
  let done = 0;
  await pool(urls, 5, async (url) => {
    try {
      const { html, finalUrl } = await get(url);
      const text = decode(html);
      add(rowFrom(text, {
        url: finalUrl.split('?')[0],
        auctioneer: 'Hollis Morgan',
        evidence: 'Hollis Morgan property page states a sold auction price and a current let on the same lot. ' + finalUrl.split('?')[0],
        address: '',
        hint: url
      }));
    } catch (e) {
      process.stdout.write('miss ' + url.split('/').slice(-2).join('/') + ' ' + e.message + '\n');
    }
    done += 1;
    if (done % 40 === 0) process.stdout.write('hollis ' + done + '/' + urls.length + ' kept ' + rows.length + '\n');
  });

  const seeds = await auctionHouse();
  process.stdout.write('AH detail candidates ' + seeds.length + '\n');
  await pool(seeds, 4, async (seed) => {
    try {
      const { html, finalUrl } = await get(seed.href);
      const text = decode(html);
      const dated = seed.ended ? text + ' auction ended ' + seed.ended : text;
      add(rowFrom(dated, {
        url: finalUrl.split('?')[0],
        auctioneer: 'Auction House',
        evidence: 'Auction House results table shows Sold for £' + seed.sold.toLocaleString('en-GB') + ' and the lot page states the current rent. Result list: https://www.auctionhouse.co.uk/' + seed.branch + '/auction/past-auctions',
        address: seed.address,
        hint: seed.address
      }));
    } catch (e) {
      process.stdout.write('ah miss ' + seed.href + ' ' + e.message + '\n');
    }
  });

  const out = { retrieved: new Date().toISOString(), rows };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  const counts = {};
  for (const r of rows) counts[r.city] = (counts[r.city] || 0) + 1;
  process.stdout.write('WROTE ' + rows.length + ' ' + JSON.stringify(counts) + '\n');
}

export { rowFrom, decode, get, cityOf, postcode };

const invoked = process.argv[1] && process.argv[1].endsWith('harvest-sold-niy.mjs');
if (invoked) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
