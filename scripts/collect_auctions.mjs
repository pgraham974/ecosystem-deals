/* Public factual metadata only. No authentication, images, descriptions or legal packs. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, normalizeLot, dedupeLots, mergePrevious } from './auctions/core.mjs';
import { collect as auctionhouse } from './auctions/auctionhouse.mjs';
import { collect as scotland } from './auctions/scotland.mjs';

export async function run({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), fetchImpl = globalThis.fetch, now = new Date().toISOString() } = {}) {
  const config = JSON.parse(await fs.readFile(path.join(root, 'scripts/auctions/sources.json'), 'utf8'));
  const outDir = path.join(root, 'data/auctions');
  await fs.mkdir(outDir, { recursive: true });
  let previous = { lots: [] };
  try { previous = JSON.parse(await fs.readFile(path.join(outDir, 'lots.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const sources = [], fresh = [];
  const robots = [];
  const client = createClient({ fetchImpl, userAgent: config.user_agent, delayMs: 1800, timeoutMs: 25000, maxRequests: 800,
    onPolicy: event => robots.push(event) });
  const adapters = { auctionhouse, scotland };
  for (const source of config.sources) {
    const row = { id: source.id, name: source.name, url: source.url, checked_at: now, status: 'skipped', reason: source.reason || '',
      lot_count: 0, commercial_excluded: 0, out_of_area_excluded: 0, unknown_excluded: 0, pages: 0,
      policy: source.policy, errors: [] };
    sources.push(row);
    if (!source.enabled) { row.status = source.coverage_status || 'skipped'; continue; }
    try {
      if (!source.policy || source.policy.status !== 'public_metadata_only') throw new Error('Policy approval/review missing; collection disabled.');
      if (!source.policy.review_due || now.slice(0, 10) > source.policy.review_due) throw new Error('Policy review expired; re-review terms before enabling collection.');
      if (!adapters[source.adapter]) throw new Error('No supported adapter; not collected.');
      // Fail closed if newly published website terms contain an aggregation/reuse restriction.
      // The audit in sources.json remains authoritative for disabled providers, which are never requested.
      const policyHtml = await client(source.policy.terms_url || source.url);
      const policyText = policyHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const restrictive = /(?:may only be accessed manually|automated (?:agents|software).{0,120}(?:forbidden|prohibited)|(?:data (?:gathering|extraction)|scrap(?:ing|ers?)).{0,150}(?:written permission|prohibited|not permitted)|must not use.{0,150}commercial purposes|(?:content|materials?).{0,90}(?:may not|must not|cannot).{0,80}(?:reproduced|republished)|(?:copying|reproduction).{0,100}strictly prohibited|personal and non-commercial use)/i;
      if (restrictive.test(policyText)) throw new Error('Published terms may restrict automated extraction/reuse; stopped for policy review.');
      const result = await adapters[source.adapter]({ get: client, source, now });
      row.pages = result.pages || 0;
      row.successful_pages = result.successful_pages || 0;
      row.warnings = result.warnings || [];
      row.commercial_excluded = result.commercial_excluded || 0;
      row.errors = result.errors || [];
      for (const raw of result.lots || []) {
        const normalized = normalizeLot(raw, { source, now });
        if (normalized.lot) { fresh.push(normalized.lot); row.lot_count++; }
        else if (normalized.reason === 'commercial') row.commercial_excluded++;
        else if (normalized.reason === 'out_of_area') row.out_of_area_excluded++;
        else row.unknown_excluded++;
      }
      row.status = row.errors.length ? (row.successful_pages ? 'partial' : 'failed') : 'live';
      row.reason = row.errors.length ? row.errors.join('; ') : 'Public factual metadata collected. No open-data licence claimed; see policy scope.';
      if (row.successful_pages === 0) { row.status = 'failed'; row.reason = row.reason || 'No catalogue/result pages successfully read.'; }
    } catch (e) { row.status = 'failed'; row.reason = String(e.message || e); row.errors.push(row.reason); }
  }
  const unique = dedupeLots(fresh);
  const retained = mergePrevious(unique, previous.lots || [], { sources }, now);
  const lots = dedupeLots(Array.isArray(retained) ? retained : retained.lots || []);
  const success = sources.some(s => s.status === 'live' || s.status === 'partial');
  const lastSuccess = success ? now : previous.updated_at || null;
  const counts = Object.fromEntries(config.towns.map(town => [town, lots.filter(l => l.town === town && !l.stale).length]));
  const statuses = Object.fromEntries(config.towns.map(town => [town, Object.fromEntries(['upcoming','sold','unsold','withdrawn'].map(status => [status, lots.filter(l => l.town === town && l.status === status && !l.stale).length]))]));
  const coverage = { schema_version: 1, updated_at: now, last_successful_refresh: lastSuccess,
    scope: 'Target post towns only, not all properties in surrounding auction regions. Counts are fresh, deduplicated residential lots actually read; not a census. Exclusions refer to inspected records, not site-wide totals.',
    metadata_only: true, sources, robots, counts_by_town: counts, counts_by_town_and_status: statuses,
    total_fresh: lots.filter(l => !l.stale).length, total_stale: lots.filter(l => l.stale).length,
    commercial_excluded: sources.reduce((n, s) => n + s.commercial_excluded, 0),
    duplicates_removed: fresh.length - unique.length };
  // Atomic single-file writes. The workflow commits both files together as one snapshot.
  for (const [name, data] of [['lots.json', { schema_version: 1, updated_at: lastSuccess, attempted_at: now, lots }], ['coverage.json', coverage]]) {
    const file = path.join(outDir, name);
    await fs.writeFile(file + '.tmp', JSON.stringify(data, null, 2) + '\n');
    await fs.rename(file + '.tmp', file);
  }
  const lines = ['# Auction collection', '', `Checked: ${now}`, '', `Fresh: ${coverage.total_fresh}; stale: ${coverage.total_stale}; commercial/other non-residential inspected records excluded: ${coverage.commercial_excluded}.`, '', '## Town counts (fresh, deduplicated)', ...config.towns.map(t => `- ${t}: ${counts[t]}`), '', '## Source coverage', ...sources.map(s => `- **${s.name}**: ${s.status}; ${s.lot_count} eligible lots; ${s.commercial_excluded} non-residential excluded. ${s.reason}`), '', 'No lot or sold price is fabricated. A starting/opening/current bid is not a guide or sale price. Missing results do not mean no sales occurred. Unavailable-source rows retain their original scraped_at and are labelled stale.'];
  await fs.writeFile(path.join(outDir, 'coverage.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify({ checked_at: now, counts_by_town: counts, fresh: coverage.total_fresh, stale: coverage.total_stale, sources: sources.map(s => ({ name: s.name, status: s.status, lots: s.lot_count })) }, null, 2));
  return coverage;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await run();
  // Preserve diagnostic JSON while making complete collection failure visible in Actions.
  if (!result.sources.some(s => s.status === 'live' || s.status === 'partial')) process.exitCode = 1;
}
