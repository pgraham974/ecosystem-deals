/* Re-read each stored lot page and keep a grade only when the page states a receiver, lender or mortgagee instruction. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, instructionEvidence, normalizeLot, sortLotsByGrade } from './core.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const config = JSON.parse(await fs.readFile(path.join(root, 'scripts/auctions/sources.json'), 'utf8'));
const file = path.join(root, 'data/auctions/lots.json');
const snapshot = JSON.parse(await fs.readFile(file, 'utf8'));
const get = createClient({ userAgent: config.user_agent, delayMs: 1200, timeoutMs: 20000, maxRequests: 200 });
let graded = 0, missed = 0;
for (const lot of snapshot.lots || []) {
  try {
    const html = await get(lot.source_url);
    const evidence = instructionEvidence(html);
    if (!evidence) { missed++; continue; }
    const normalized = normalizeLot({ ...lot, forced_sale_evidence: evidence, forced_sale_evidence_url: lot.source_url, grade: '', grade_verified: false }, { source: lot.source });
    if (normalized.lot && normalized.lot.grade) {
      lot.grade = normalized.lot.grade;
      lot.grade_evidence = normalized.lot.grade_evidence;
      lot.grade_evidence_url = normalized.lot.grade_evidence_url;
      lot.grade_verified = true;
      graded++;
      console.log(lot.grade, lot.address);
    } else missed++;
  } catch (error) {
    missed++;
    console.log('skip', lot.source_url, error.code || error.message);
  }
}
if (graded) {
  snapshot.lots = sortLotsByGrade(snapshot.lots || []);
  await fs.writeFile(file, JSON.stringify(snapshot, null, 2) + '\n');
}
console.log(JSON.stringify({ graded, missed, lots: (snapshot.lots || []).length, written: graded > 0 }));
