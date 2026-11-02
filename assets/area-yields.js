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

  function drawPanel(city) {
    const host = document.getElementById('comp_area_yields');
    if (!host || !cache.evidence) return;
    const key = cityKey(city || 'Cheltenham');
    const all = rowsFor(cache.evidence, cache.auctions);
    const sets = setsForCity(all, key, null);
    const agents = all.filter(function (r) { return r.city === key && r.yield_kind === 'agent_view'; });
    const headlines = sets.map(function (set) {
      if (!set.average) return '<p><b>' + esc(set.asset) + '</b> ' + esc(set.status) + '. ' + set.members.length + ' row' + (set.members.length === 1 ? '' : 's') + '. Fewer than two comparable rows, so there is no average.</p>';
      const kind = set.kind === 'gross' ? ' This is a gross yield, not an NIY.' : '';
      const thin = set.average.thin ? ' Thin sample (fewer than 5).' : '';
      const asking = set.used.every(function (r) { return r.quote_status === 'asking'; }) ? ' All of these are asking quotes, not completed sales.' : '';
      return '<p><b>' + esc(set.asset) + '</b> unweighted mean ' + pct(set.average.mean) + ' from ' + set.average.n + ' rows.' + esc(thin + asking + kind) + '</p>';
    }).join('');
    const cheltenhamGap = key === 'Cheltenham' && !(cache.auctions.rows || []).some(function (r) { return r.city === 'Cheltenham'; })
      ? '<p class="foot">No Cheltenham auction lot in this copy states both a sold price and a rent, so there is no Cheltenham residential gross yield.</p>' : '';
    host.innerHTML = '<h2>Yields by place</h2><p class="lead">' + esc(key) + ' only. Manchester, Cheltenham and Bristol are kept apart. ' + esc(cache.evidence.rule) + '</p>' +
      headlines + cheltenhamGap + rowTable(all.filter(function (r) { return r.city === key; })) +
      (agents.length ? '' : '') +
      '<p class="foot">Residential rows come from auction lots already on this site where the same lot states a price and a rent. Office rows are the published sources named in the table. Savills’ prime and secondary yields, where shown, are that firm’s market view and are not averaged.</p>';
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
    if (!set || !set.average) return;
    state.entryYield = set.average.mean;
    state.niyMode = 'average';
    state.niySet = set.id;
    state.niyUserOverride = false;
    const input = document.getElementById('uw_entryYield');
    if (input) input.value = String(set.average.mean);
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
    const city = cityKey(state.city);
    const subject = isStJames(state) ? 'st-james-house' : '';
    const sets = setsForCity(rowsFor(cache.evidence, cache.auctions), city, subject);
    const chosenId = state.niySet && sets.some(function (s) { return s.id === state.niySet; }) ? state.niySet : (DEFAULT_SET[city] || (sets[0] && sets[0].id) || '');
    const chosen = sets.filter(function (s) { return s.id === chosenId; })[0] || sets[0];
    const mode = state.niyMode === 'average' ? 'average' : 'manual';
    const quote = city === 'Cheltenham' ? subjectQuote() : null;
    const avg = chosen && chosen.average;
    let warning = '';
    if (chosen && !avg) warning = 'This set has fewer than two comparable rows, so it is not an average. The rows are listed below. Type an NIY if you want a number in the model.';
    else if (avg) {
      warning = 'Unweighted mean of ' + avg.n + ' row' + (avg.n === 1 ? '' : 's') + (avg.thin ? '. Thin sample: fewer than 5.' : '.');
      if (chosen.used.every(function (r) { return r.quote_status === 'asking'; })) warning += ' Every row is an asking quote, not a completed sale.';
      if (chosen.kind === 'gross') warning += ' These are gross yields (rent ÷ price), not net initial yields. Putting a gross yield in the NIY box prices the deal as if costs, voids and management were nil.';
      if (subject) warning += ' St James House is left out of this mean, because that quote belongs to the asset rather than the area.';
    }
    if (mode === 'average' && state.niyUserOverride) warning += ' You have typed over the mean. Reset to put the mean back.';
    box.innerHTML = '<h3>Yield you want to buy at</h3><div class="ctl"><label><input type="radio" name="niy_mode" value="manual"' + (mode === 'manual' ? ' checked' : '') + '> Manual</label><label><input type="radio" name="niy_mode" value="average"' + (mode === 'average' ? ' checked' : '') + '> Use area average</label></div>' +
      '<label class="dlf"><small>Evidence for ' + esc(city || 'this deal') + '</small><select id="niy_set">' +
      sets.map(function (s) {
        const tag = s.average ? 'mean ' + pct(s.average.mean) + ' (n=' + s.average.n + ')' : 'no average (n=' + s.used.length + ')';
        return '<option value="' + esc(s.id) + '"' + (chosen && s.id === chosen.id ? ' selected' : '') + '>' + esc(s.asset) + ' — ' + esc(s.status) + ' — ' + tag + '</option>';
      }).join('') + '</select></label>' +
      (quote ? '<p><b>' + (subject ? 'Vendor quote on this asset. ' : 'Vendor quote on St James House, kept separate from the area average. ') + '</b>' + pct(quote.yield_pct) + ' NIY, asking, not a completed sale. Offers in excess of £20 million, purchaser’s costs assumed at 6.80%. <a href="' + esc(quote.url) + '" target="_blank" rel="noopener">Source</a>. The January 2021 sale of the same building was 7.5% NIY at £21.8 million. Neither figure is the area average.</p>' : '') +
      '<p>' + esc(warning || 'Choose manual and the number in the NIY box is yours. 5.55% is only the model’s starting assumption.') + '</p>' +
      (mode === 'average' && avg ? '<p><button class="btn sec" id="niy_reset" type="button">Reset to the ' + pct(avg.mean) + ' mean</button></p>' : '') +
      (chosen ? rowTable(chosen.members.map(function (r) {
        const copy = Object.assign({}, r);
        if (subject && r.subject_id === subject) copy.notes = 'Left out of the area average while this deal is St James House. ' + r.notes;
        return copy;
      })) : '') +
      '<p class="foot">Changing the NIY box after you choose the average keeps your figure and still shows the evidence.</p>';
    box.querySelectorAll('input[name="niy_mode"]').forEach(function (el) {
      el.onchange = function () {
        state.niyMode = el.value;
        state.niySet = (document.getElementById('niy_set') || {}).value || chosenId;
        if (el.value === 'average') {
          const next = sets.filter(function (s) { return s.id === state.niySet; })[0];
          if (next && next.average) applyAverage(next, state);
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
        const next = sets.filter(function (s) { return s.id === sel.value; })[0];
        if (next && next.average) applyAverage(next, state);
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
        const nextSets = setsForCity(rowsFor(cache.evidence, cache.auctions), now.city, isStJames(now) ? 'st-james-house' : '');
        if (!nextSets.some(function (s) { return s.id === now.niySet; })) now.niySet = (DEFAULT_SET[cityKey(now.city)] || (nextSets[0] && nextSets[0].id) || '');
        if (now.niyMode === 'average' && !now.niyUserOverride) {
          const next = nextSets.filter(function (s) { return s.id === now.niySet; })[0];
          if (next && next.average) applyAverage(next, now);
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
      const sets = setsForCity(rowsFor(cache.evidence, cache.auctions), state.city, isStJames(state) ? 'st-james-house' : '');
      const chosen = sets.filter(function (s) { return s.id === state.niySet; })[0];
      const mean = chosen && chosen.average && chosen.average.mean;
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
