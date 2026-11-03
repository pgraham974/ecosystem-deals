/* Place-specific yields for Manchester, Cheltenham and Bristol. No UK-wide number. */
(function () {
  'use strict';

  const cache = { evidence: null, auctions: null };
  const DEFAULT_SET = {
    Cheltenham: 'cheltenham-office-asking',
    Manchester: 'manchester-office-sold',
    Bristol: 'bristol-hmo-passing'
  };

  function esc(s) {
    return (typeof window !== 'undefined' && typeof window.esc === 'function') ? window.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function cityKey(city) {
    const t = String(city || '');
    if (/bristol/i.test(t)) return 'Bristol';
    if (/cheltenham/i.test(t)) return 'Cheltenham';
    if (/manchester/i.test(t)) return 'Manchester';
    return t;
  }

  function isStJames(state) {
    const blob = [state && state.name, state && state.pc, state && state.tenant, state && state.prefill_note, state && state.source_url].join(' ').toLowerCase();
    return /st\.?\s*james/.test(blob) || /\bgl50\s*3/.test(blob);
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function auctionBucket(row) {
    const type = String(row.type || '');
    const basis = row.rent_basis;
    if (type === 'HMO' && basis === 'passing') return { id: 'hmo-passing', asset: 'Residential investment — HMO, passing rent', kind: 'gross' };
    if (/^flat$/i.test(type) && basis === 'potential') return { id: 'flat-potential', asset: 'Residential flat — potential rent stated on the lot', kind: 'gross' };
    if (/^flat$/i.test(type) && basis === 'passing') return { id: 'flat-passing', asset: 'Residential investment — flat, passing rent', kind: 'gross' };
    if (/mixed/i.test(type) && /retail|shop/i.test(type) && basis === 'passing') return { id: 'mixed-retail', asset: 'Mixed-use lot including a shop — whole lot, not a shop NIY', kind: 'gross' };
    return null;
  }

  function auctionRows(rows) {
    return (rows || []).map(function (row) {
      const bucket = auctionBucket(row);
      if (!bucket) return null;
      return {
        id: 'auction-' + (row.url || row.address),
        city: row.city,
        location: row.address + (row.postcode ? ', ' + row.postcode : ''),
        asset_type: bucket.asset,
        set_id: row.city.toLowerCase() + '-' + bucket.id,
        yield_pct: round2(row.gross_yield * 100),
        yield_kind: 'gross',
        date: row.sold_date || '',
        sample: 'Single lot',
        in_average: true,
        quote_status: 'completed sale',
        source: (row.auctioneer || 'Auction catalogue') + '. Gross yield is the stated rent divided by the sold price.',
        url: row.url || '',
        notes: (row.rent_basis === 'passing' ? 'Passing rent. ' : 'The rent is a potential or asking rent, not confirmed passing rent. ') + (row.evidence || '') + ' Not a net initial yield.'
      };
    }).filter(Boolean);
  }

  function rowsFor(evidence, auctions) {
    return (evidence && evidence.rows || []).concat(auctionRows(auctions && auctions.rows));
  }

  function qualifies(row, subject) {
    if (!row.in_average || row.yield_kind === 'agent_view') return false;
    if (subject && row.subject_id === subject) return false;
    return true;
  }

  function averageOf(rows) {
    if (!rows || rows.length < 2) return null;
    const mean = rows.reduce(function (sum, row) { return sum + Number(row.yield_pct); }, 0) / rows.length;
    return { mean: round2(mean), n: rows.length, thin: rows.length < 5, kinds: rows.map(function (r) { return r.yield_kind; }), statuses: rows.map(function (r) { return r.quote_status; }) };
  }

  function setsForCity(all, city, subject) {
    const key = cityKey(city);
    const mine = all.filter(function (row) { return row.city === key && row.set_id !== 'agent-view'; });
    const ids = [];
    mine.forEach(function (row) { if (ids.indexOf(row.set_id) < 0) ids.push(row.set_id); });
    return ids.map(function (id) {
      const members = mine.filter(function (row) { return row.set_id === id; });
      const used = members.filter(function (row) { return qualifies(row, subject); });
      const sample = members[0] || {};
      return {
        id: id,
        city: key,
        asset: sample.asset_type || id,
        kind: sample.yield_kind || '',
        status: sample.quote_status || '',
        members: members,
        used: used,
        average: averageOf(used)
      };
    });
  }

  function load() {
    if (cache.evidence && cache.auctions) return Promise.resolve(cache);
    return Promise.all([
      fetch('comps/area-yields.json').then(function (r) { return r.ok ? r.json() : { rows: [] }; }),
      fetch('comps/yields.json').then(function (r) { return r.ok ? r.json() : { rows: [] }; })
    ]).then(function (pair) {
      cache.evidence = pair[0];
      cache.auctions = pair[1];
      return cache;
    });
  }

  function pct(n) {
    return n == null ? '—' : Number(n).toFixed(2) + '%';
  }

  function rowTable(rows) {
    if (!rows.length) return '<p>No published row for this place in the file.</p>';
    return '<div class="scroll"><table><thead><tr><th class="l">Location</th><th class="l">Asset</th><th>Yield</th><th>Kind</th><th>Date</th><th>Sample</th><th>Source</th><th>Asking or sold</th><th class="l">Notes</th></tr></thead><tbody>' +
      rows.map(function (r) {
        const link = r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.source) + '</a>' : esc(r.source);
        return '<tr><td class="l">' + esc(r.location) + '</td><td class="l">' + esc(r.asset_type) + '</td><td>' + pct(r.yield_pct) + '</td><td>' + esc(r.yield_kind === 'niy' ? 'NIY' : r.yield_kind === 'gross' ? 'Gross' : 'Agent view') + '</td><td>' + esc(r.date || '—') + '</td><td>' + esc(r.sample) + '</td><td>' + link + '</td><td>' + esc(r.quote_status) + '</td><td class="l">' + esc(r.notes) + (r.in_average ? '' : ' Not in an average.') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function niyBook() {
    if (!window.lcNiy) return [];
    return window.lcNiy.book(cache.evidence, cache.auctions);
  }

  function averageTable(rows) {
    const areas = (window.lcNiy && window.lcNiy.AREAS) || [];
    const body = areas.map(function (city) {
      const place = window.lcNiy && window.lcNiy.areaLabel ? window.lcNiy.areaLabel(city) : city;
      const mine = rows.filter(function (r) { return r.city === city && r.stat; });
      if (!mine.length) return '<tr><td class="l">' + esc(place) + '</td><td class="l" colspan="6">No residential NIY comps. Nothing was estimated.</td></tr>';
      return mine.map(function (r) {
        const s = r.stat;
        const dates = (s.from || '—') + (s.to && s.to !== s.from ? ' to ' + s.to : '');
        const low = s.n < 3 ? ' · low sample' : '';
        const place = window.lcNiy && window.lcNiy.areaLabel ? window.lcNiy.areaLabel(r.city) : r.city;
        return '<tr' + (s.n < 3 ? ' class="niy-low"' : '') + '><td class="l">' + esc(place) + '</td><td class="l">' + esc(r.asset) + low + '</td><td class="niy-mean"><b>' + pct(s.mean) + '</b> <span class="niy-n">n=' + s.n + '</span></td><td>' + pct(s.median) + '</td><td class="niy-mean"><span class="niy-n">n=' + s.n + '</span></td><td>' + pct(s.min) + ' – ' + pct(s.max) + '</td><td>' + esc(dates) + '</td></tr>';
      }).join('');
    }).join('');
    return '<div class="scroll"><table class="niy-avg"><thead><tr><th class="l">Area</th><th class="l">Asset</th><th>Mean</th><th>Median</th><th>n</th><th>Range</th><th>Dates</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function drawPanel(city) {
    const host = document.getElementById('comp_area_yields');
    if (!host || !cache.evidence) return;
    const key = cityKey(city || 'Cheltenham');
    const comps = niyBook();
    const counts = window.lcNiy ? window.lcNiy.counts(comps) : { published: 0, derived: 0, unavailable: 0 };
    const avgs = window.lcNiy ? window.lcNiy.averages(comps) : [];
    const here = comps.filter(function (r) { return r.city === key; });
    const lines = here.map(function (r) {
      const link = r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.source) + '</a>' : esc(r.source);
      const niy = r.pct == null ? 'NIY unavailable' : pct(r.pct) + (r.review ? ' · review' : '');
      const place = window.lcNiy && window.lcNiy.areaLabel ? window.lcNiy.areaLabel(r.city) : r.city;
      const town = r.subArea && r.subArea !== place ? r.subArea : '';
      const where = esc(r.address) + (town ? ' <span class="foot">' + esc(town) + (place ? ' · ' + esc(place) : '') + '</span>' : (place && place !== r.city ? ' <span class="foot">' + esc(place) + '</span>' : ''));
      return '<tr><td class="l">' + where + '</td><td class="l">' + esc(r.asset) + '</td><td>' + niy + '</td><td>' + esc(r.basis) + '</td><td>' + esc(r.date || '—') + '</td><td class="l">' + link + '<div class="foot">' + esc(r.note) + (r.average === false ? ' Not in an average.' : '') + '</div></td></tr>';
    }).join('');
    const tally = {};
    ((window.lcNiy && window.lcNiy.AREAS) || []).forEach(function (name) { tally[name] = { verified: 0, inAverage: 0 }; });
    comps.forEach(function (r) {
      if (!tally[r.city]) return;
      if (r.basis === 'derived' || (r.basis === 'published' && r.average)) tally[r.city].verified += 1;
      if (r.average) tally[r.city].inAverage += 1;
    });
    const tallyHtml = '<div class="niy-area-counts">' + Object.keys(tally).map(function (name) {
      const t = tally[name];
      const place = window.lcNiy && window.lcNiy.areaLabel ? window.lcNiy.areaLabel(name) : name;
      return '<div><b>n=' + t.verified + '</b>' + esc(place) + '<span class="foot">' + t.inAverage + ' in the 3–12% residential averages</span></div>';
    }).join('') + '</div>';
    host.innerHTML = '<h2>NIY by area and asset</h2><p class="lead">Each average is shown with its sample size. A verified comp has a passing rent and a completed sold price on the same source. The target is 100 verified comps in each area, including labelled surrounding towns. Nothing is estimated.</p>' +
      tallyHtml +
      '<p class="foot">In this evidence file: ' + (counts.published || 0) + ' published, ' + (counts.derived || 0) + ' derived from passing rent and a sold price, ' + (counts.unverified || 0) + ' unverified (kept out), ' + (counts.unavailable || 0) + ' unavailable, ' + (counts.review || 0) + ' flagged because the NIY is outside 3% to 12%. ' + (counts.inAverage || 0) + ' comps go into an average. Averages with fewer than 3 comps are marked low sample and are not in the deal picker.</p>' +
      averageTable(avgs) +
      '<h3>' + esc(key) + ' comps</h3>' +
      (lines ? '<div class="scroll"><table><thead><tr><th class="l">Comp</th><th class="l">Asset</th><th>NIY</th><th>Basis</th><th>Date</th><th class="l">Source</th></tr></thead><tbody>' + lines + '</tbody></table></div>' : '<p>No comp loaded for ' + esc(key) + '.</p>') +
      '<p class="foot">Agent market views are shown with their published figure and are not in the averages. Land Registry sales have no rent, so their NIY is unavailable and they are not in this table.</p>';
  }

  function draw() {
    const citySel = document.getElementById('comp_city');
    drawPanel(citySel && citySel.value || 'Manchester');
  }

  function subjectQuote() {
    const all = rowsFor(cache.evidence, cache.auctions);
    return all.find(function (r) { return r.id === 'st-james-asking-2026'; }) || null;
  }

  function applyAverage(set, state) {
    const mean = set && (set.stat ? set.stat.mean : (set.average && set.average.mean));
    if (mean == null) return;
    state.entryYield = mean;
    state.niyMode = 'average';
    state.niySet = set.id;
    state.niyUserOverride = false;
    const input = document.getElementById('uw_entryYield');
    if (input) input.value = String(mean);
  }

  function mountDeal() {
    const field = document.getElementById('uw_entryYield');
    if (!field || document.getElementById('niy_box') || !cache.evidence) return;
    const label = field.closest('label') || field.parentElement;
    const box = document.createElement('div');
    box.id = 'niy_box';
    box.className = 'card';
    label.parentElement.insertBefore(box, label);
    paintDeal();
  }

  function paintDeal() {
    const box = document.getElementById('niy_box');
    const state = (typeof UW !== 'undefined' && UW.state) || null;
    if (!box || !state || !cache.evidence) return;
    const comps = niyBook();
    const rows = window.lcNiy ? window.lcNiy.averages(comps).filter(function (r) { return r.stat; }) : [];
    const hinted = window.lcNiy ? window.lcNiy.pickId(comps, state) : '';
    const chosenId = state.niySet && rows.some(function (r) { return r.id === state.niySet && r.stat.n >= 3; }) ? state.niySet : hinted;
    const chosen = rows.filter(function (r) { return r.id === chosenId && r.stat.n >= 3; })[0];
    const mode = state.niyMode === 'average' ? 'average' : 'manual';
    const quote = cityKey(state.city) === 'Cheltenham' ? subjectQuote() : null;
    const avg = chosen && chosen.stat;
    const matchNote = window.lcNiy && window.lcNiy.hintAsset(state)
      ? ' Pre-selected from the deal’s town and type (' + window.lcNiy.hintAsset(state) + ').'
      : ' No asset type is named on the deal, so the largest sample in the town is pre-selected.';
    const inUse = chosen && avg
      ? (window.lcNiy && window.lcNiy.areaLabel ? window.lcNiy.areaLabel(chosen.city) : chosen.city) + ' · ' + chosen.asset + ' · ' + pct(avg.mean) + ' (n=' + avg.n + ') · median ' + pct(avg.median)
      : 'No average selected';
    box.innerHTML = '<h3>Yield you want to buy at</h3><div class="ctl"><label><input type="radio" name="niy_mode" value="manual"' + (mode === 'manual' ? ' checked' : '') + '> Enter a figure</label><label><input type="radio" name="niy_mode" value="average"' + (mode === 'average' ? ' checked' : '') + '> Use an area average</label></div>' +
      '<p class="niy-inuse"><b>In use:</b> ' + esc(mode === 'average' ? inUse : 'Your own figure') + '</p>' +
      '<label class="dlf"><small>Every area and asset type</small><select id="niy_set">' +
      (!chosen ? '<option value="" selected>No average with 3 or more comps for this town</option>' : '') +
      rows.map(function (s) {
        const low = s.stat.n < 3;
        const place = window.lcNiy && window.lcNiy.areaLabel ? window.lcNiy.areaLabel(s.city) : s.city;
        return '<option value="' + esc(s.id) + '"' + (low ? ' disabled' : '') + (chosen && s.id === chosen.id ? ' selected' : '') + '>' + esc(place) + ' · ' + esc(s.asset) + ' · ' + pct(s.stat.mean) + ' (n=' + s.stat.n + ')' + (low ? ' · low sample' : '') + '</option>';
      }).join('') + '</select></label>' +
      '<p class="foot">' + esc(matchNote) + (avg && avg.n < 5 ? ' Thin sample.' : '') + '</p>' +
      (quote ? '<p><b>' + (isStJames(state) ? 'Vendor quote on this asset. ' : 'Vendor quote on St James House, kept separate. ') + '</b>' + pct(quote.yield_pct) + ' published NIY, asking. <a href="' + esc(quote.url) + '" target="_blank" rel="noopener">Source</a>.</p>' : '') +
      (mode === 'average' && avg ? '<p><button class="btn sec" id="niy_reset" type="button">Reset to the ' + pct(avg.mean) + ' mean (n=' + avg.n + ')</button></p>' : '') +
      '<details class="ios-disc"><summary>Mean, median, n, range and dates</summary>' + averageTable(window.lcNiy ? window.lcNiy.averages(comps) : []) +
      (chosen ? '<p class="foot">Comps in the selected average</p><ul>' + chosen.rows.map(function (r) {
        return '<li>' + esc(r.address) + (r.subArea ? ' · ' + esc(r.subArea) : '') + ' · ' + (r.pct == null ? 'NIY unavailable' : pct(r.pct)) + ' · ' + esc(r.basis) + '</li>';
      }).join('') + '</ul>' : '') + '</details>' +
      '<p class="foot">Changing the NIY box after you choose an average keeps your figure. The list still shows which average you picked.</p>';
    box.querySelectorAll('input[name="niy_mode"]').forEach(function (el) {
      el.onchange = function () {
        state.niyMode = el.value;
        state.niySet = (document.getElementById('niy_set') || {}).value || chosenId;
        if (el.value === 'average') {
          const next = rows.filter(function (s) { return s.id === state.niySet; })[0];
          if (next && next.stat && next.stat.n >= 3) applyAverage(next, state);
        }
        if (typeof uwStore === 'function') uwStore();
        if (typeof uwUpdate === 'function') uwUpdate();
        paintDeal();
      };
    });
    const sel = document.getElementById('niy_set');
    if (sel) sel.onchange = function () {
      state.niySet = sel.value;
      if (state.niyMode === 'average') {
        const next = rows.filter(function (s) { return s.id === sel.value; })[0];
        if (next && next.stat && next.stat.n >= 3) applyAverage(next, state);
        else state.niyUserOverride = false;
      }
      if (typeof uwStore === 'function') uwStore();
      if (typeof uwUpdate === 'function') uwUpdate();
      paintDeal();
    };
    const reset = document.getElementById('niy_reset');
    if (reset) reset.onclick = function () {
      if (chosen && chosen.average) applyAverage(chosen, state);
      if (typeof uwStore === 'function') uwStore();
      if (typeof uwUpdate === 'function') uwUpdate();
      paintDeal();
    };
    ['uw_city', 'uw_name', 'uw_pc'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el || el.dataset.niyWatch) return;
      el.dataset.niyWatch = '1';
      el.addEventListener('change', function () {
        const now = UW.state;
        if (!now) return;
        const compsNow = niyBook();
        const nextId = window.lcNiy ? window.lcNiy.pickId(compsNow, now) : '';
        const nextRows = window.lcNiy ? window.lcNiy.averages(compsNow).filter(function (r) { return r.stat; }) : [];
        if (!nextRows.some(function (s) { return s.id === now.niySet; })) now.niySet = nextId;
        if (now.niyMode === 'average' && !now.niyUserOverride) {
          const next = nextRows.filter(function (s) { return s.id === now.niySet; })[0];
          if (next && next.stat && next.stat.n >= 3) applyAverage(next, now);
        }
        paintDeal();
      });
    });
  }

  function watchEntry() {
    const input = document.getElementById('uw_entryYield');
    if (!input || input.dataset.niy) return;
    input.dataset.niy = '1';
    input.addEventListener('input', function () {
      const state = UW.state;
      if (!state || state.niyMode !== 'average') return;
      const rows = window.lcNiy ? window.lcNiy.averages(niyBook()).filter(function (r) { return r.stat; }) : [];
      const chosen = rows.filter(function (s) { return s.id === state.niySet; })[0];
      const mean = chosen && chosen.stat && chosen.stat.mean;
      state.niyUserOverride = mean == null || Number(input.value) !== mean;
    });
  }

  function bootDeal() {
    load().then(function () {
      mountDeal();
      watchEntry();
    }).catch(function (e) { console.log('yields', e); });
  }

  if (typeof uwStart === 'function') {
    const prev = uwStart;
    uwStart = async function () {
      await prev();
      bootDeal();
    };
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.lcDrawAreaYields = function () { load().then(draw).catch(function () {}); };
  root.lcAreaYield = { cityKey: cityKey, setsForCity: setsForCity, rowsFor: rowsFor, averageOf: averageOf, isStJames: isStJames, auctionBucket: auctionBucket };

  if (typeof document !== 'undefined' && document.getElementById('comp_area_yields')) root.lcDrawAreaYields();
})();
