/** Hollis lots in North Somerset and Bath, grouped with Bristol when the postcode is BS or BA. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { rowFrom, decode, get } from './harvest-sold-niy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const xml = fs.readFileSync('/tmp/hollis-sitemap.xml', 'utf8');
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u =>
  /\/property-details\//.test(u) && /\/(north-somerset|bath-and-north-east-somerset)\//.test(u)
);

const rows = [];
let i = 0;
async function worker() {
  while (i < urls.length) {
    const url = urls[i++];
    try {
      const { html, finalUrl } = await get(url);
      const row = rowFrom(decode(html), {
        url: finalUrl.split('?')[0],
        auctioneer: 'Hollis Morgan',
        evidence: 'Hollis Morgan property page states a sold auction price and a current let on the same lot. ' + finalUrl.split('?')[0],
        address: '',
        hint: url
      });
      if (!row) continue;
      if (row.city === 'Bristol') row.sub_area = /bath-and-north-east-somerset/.test(url) ? 'Bath' : 'North Somerset';
      rows.push(row);
      process.stdout.write('KEEP ' + row.city + ' ' + row.sold_price + ' ' + row.rent_pa + ' ' + row.address.slice(0, 70) + '\n');
    } catch (e) {
      process.stdout.write('miss ' + e.message + '\n');
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
fs.writeFileSync(path.join(ROOT, 'comps', 'hollis-extra.json'), JSON.stringify({ retrieved: new Date().toISOString(), rows }, null, 2));
process.stdout.write('WROTE ' + rows.length + ' of ' + urls.length + '\n');
