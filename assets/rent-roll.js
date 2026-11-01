/* Upload a tenancy schedule into the deal underwrite. Session only; nothing is written to the repo. */
(function () {
  'use strict';

  const FIELDS = [
    ['unit', 'Unit / flat'],
    ['tenant', 'Tenant'],
    ['rent', 'Rent'],
    ['erv', 'ERV / target rent'],
    ['start', 'Lease start'],
    ['end', 'Lease end'],
    ['status', 'Status'],
    ['sc', 'Service charge'],
    ['other', 'Other income']
  ];

  function esc(s) {
    return (typeof window !== 'undefined' && typeof window.esc === 'function') ? window.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function money(n) {
    if (n == null || !isFinite(+n)) return 'Unknown';
    return '£' + Math.round(+n).toLocaleString('en-GB');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/£/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function scoreHeader(cell, field) {
    const h = norm(cell);
    if (!h) return 0;
    const rules = {
      unit: [['unit', 5], ['flat', 5], ['apartment', 4], ['plot', 3], ['demise', 4], ['property', 2], ['address', 2], ['tenancy', 2]],
      tenant: [['tenant', 6], ['occupier', 5], ['lessee', 5], ['resident', 3]],
      rent: [['passing rent', 8], ['contracted rent', 8], ['rent pcm', 8], ['rent pa', 8], ['monthly rent', 7], ['annual rent', 7], ['rent', 4]],
      erv: [['erv', 7], ['market rent', 6], ['target rent', 6], ['quoting rent', 5]],
      start: [['lease start', 7], ['start date', 6], ['commencement', 6], ['commenced', 6], ['lease from', 5], ['from', 2]],
      end: [['lease end', 7], ['expiry', 6], ['end date', 5], ['term end', 5]],
      status: [['status', 4], ['occupancy', 5], ['void', 4], ['vacant', 4]],
      sc: [['service charge', 8], ['servicecharge', 8], ['svc charge', 7], ['svc', 5]],
      other: [['other income', 7], ['parking', 4], ['sundry', 3]]
    };
    let best = 0;
    (rules[field] || []).forEach(function (pair) {
      const term = pair[0];
      const hit = term.length <= 3 ? (' ' + h + ' ').indexOf(' ' + term + ' ') >= 0 : (h === term || h.indexOf(term) >= 0);
      if (hit) best = Math.max(best, pair[1]);
    });
    if (field === 'rent' && /review|arrear|deposit|free/.test(h)) best = Math.max(0, best - 6);
    return best;
  }

  function headerRowIndex(grid) {
    let best = 0, bestScore = 0;
    const limit = Math.min(grid.length, 15);
    for (let i = 0; i < limit; i++) {
      let score = 0;
      (grid[i] || []).forEach(function (cell) {
        FIELDS.forEach(function (f) { score += scoreHeader(cell, f[0]) ? 1 : 0; });
      });
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return bestScore ? best : 0;
  }

  function detectMap(headers) {
    const map = {};
    const ambiguous = [];
    FIELDS.forEach(function (f) {
      const scored = headers.map(function (h, i) { return { i: i, h: h, s: scoreHeader(h, f[0]) }; }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; });
      if (!scored.length) { map[f[0]] = -1; return; }
      map[f[0]] = scored[0].i;
      if (scored.length > 1 && scored[0].s - scored[1].s < 2) ambiguous.push(f[0]);
    });
    if (map.erv === map.rent || map.erv === map.sc) map.erv = -1;
    const period = detectPeriod(headers, map.rent);
    return { map: map, ambiguous: ambiguous, period: period, needsMap: map.rent < 0 || ambiguous.indexOf('rent') >= 0 };
  }

  function detectPeriod(headers, rentCol) {
    const h = norm(rentCol >= 0 ? headers[rentCol] : '');
    if (/pcm|per month|monthly|p m|per calendar/.test(h)) return 'pcm';
    if (/\bpw\b|per week|weekly/.test(h)) return 'pw';
    if (/\bpa\b|per annum|annual|p a|yearly/.test(h)) return 'pa';
    return 'pcm';
  }

  function parseMoney(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && isFinite(v)) return v;
    const t = String(v).replace(/,/g, '').replace(/£/g, '').trim();
    if (!t || /^-|n\/a|tbc|vacant|void/i.test(t)) {
      const n = t.match(/-?\d+(?:\.\d+)?/);
      if (!n || /vacant|void|tbc|n\/a/i.test(t)) return /^-?\d/.test(t) ? Number(n[0]) : null;
    }
    const n = t.replace(/[^0-9.-]/g, '');
    if (!n || n === '-' || n === '.') return null;
    const num = Number(n);
    return isFinite(num) ? num : null;
  }

  function cellPeriod(v, fallback) {
    const t = String(v || '').toLowerCase();
    if (/pcm|per month|p\.?m/.test(t)) return 'pcm';
    if (/per week|p\.?w\b|\bpw\b/.test(t)) return 'pw';
    if (/per annum|p\.?a\b|\bpa\b|annual/.test(t)) return 'pa';
    return fallback;
  }

  function toAnnual(amount, period) {
    if (amount == null) return 0;
    if (period === 'pcm') return amount * 12;
    if (period === 'pw') return amount * 52;
    return amount;
  }

  function isVoid(status, rent, tenant) {
    const s = String(status || '').toLowerCase();
    if (/void|vacant|empty|unlet|available/.test(s)) return true;
    if (/let|occupied|ast|in situ/.test(s)) return false;
    if ((rent == null || rent === 0) && !String(tenant || '').trim()) return true;
    return false;
  }

  function buildRoll(grid, mapping, period) {
    const headerAt = mapping.headerAt;
    const headers = grid[headerAt] || [];
    const col = mapping.map;
    const lines = [];
    for (let r = headerAt + 1; r < grid.length; r++) {
      const cells = grid[r] || [];
      if (!cells.some(function (c) { return String(c).trim(); })) continue;
      const get = function (k) { return col[k] >= 0 ? cells[col[k]] : ''; };
      const rentRaw = get('rent');
      const rentNum = parseMoney(rentRaw);
      const rowPeriod = cellPeriod(rentRaw, period);
      const status = get('status');
      const tenant = String(get('tenant') || '').trim();
      const unit = String(get('unit') || '').trim() || ('Row ' + (r + 1));
      const vacant = isVoid(status, rentNum, tenant);
      const ervNum = parseMoney(get('erv'));
      const scNum = parseMoney(get('sc'));
      const otherNum = parseMoney(get('other'));
      lines.push({
        unit: unit,
        tenant: tenant,
        vacant: vacant,
        rentInput: rentNum,
        period: rowPeriod,
        rentPa: vacant ? 0 : toAnnual(rentNum || 0, rowPeriod),
        ervPa: ervNum == null ? null : toAnnual(ervNum, cellPeriod(get('erv'), period)),
        scPa: scNum == null ? 0 : toAnnual(scNum, cellPeriod(get('sc'), 'pcm')),
        otherPa: otherNum == null ? 0 : toAnnual(otherNum, cellPeriod(get('other'), 'pa')),
        start: String(get('start') || '').trim(),
        end: String(get('end') || '').trim(),
        status: String(status || (vacant ? 'Vacant' : 'Let')).trim()
      });
    }
    return { headers: headers, lines: lines, period: period };
  }

  function summarise(lines) {
    const letRows = lines.filter(function (r) { return !r.vacant; });
    const voidRows = lines.filter(function (r) { return r.vacant; });
    const passing = letRows.reduce(function (a, r) { return a + r.rentPa; }, 0);
    const sc = lines.reduce(function (a, r) { return a + (r.scPa || 0); }, 0);
    const other = lines.reduce(function (a, r) { return a + (r.otherPa || 0); }, 0);
    const ervColumnUsed = lines.some(function (r) { return r.ervPa != null; });
    const ervMissing = !ervColumnUsed || voidRows.some(function (r) { return r.ervPa == null; });
    const erv = ervMissing ? null : letRows.reduce(function (a, r) { return a + (r.ervPa != null ? r.ervPa : r.rentPa); }, 0) + voidRows.reduce(function (a, r) { return a + r.ervPa; }, 0);
    const avg = letRows.length ? passing / letRows.length : null;
    return {
      homes: lines.length,
      letHomes: letRows.length,
      voidHomes: voidRows.length,
      occupancy: lines.length ? letRows.length / lines.length : null,
      passingPa: passing,
      avgLetPa: avg,
      servicePa: sc,
      otherPa: other,
      ervStabilisedPa: erv,
      estimatedStabilisedPa: avg == null ? null : passing + avg * voidRows.length
    };
  }

  function loadXlsx() {
    if (typeof XLSX !== 'undefined') return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'assets/vendor/xlsx.full.min.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Excel parser failed to load.')); };
      document.head.appendChild(s);
    });
  }

  async function gridFromFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCsv(await file.text());
    await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  }

  function templateRows() {
    return parseCsv(TEMPLATE);
  }

  const TEMPLATE = 'Unit,Tenant,Rent PCM,Lease start,Lease end,Status,Service charge PCM,Other income PA\nFlat 1,Example tenant A,850,2024-06-01,2026-05-31,Let,40,0\nFlat 2,Example tenant B,900,2025-01-15,2026-01-14,Let,40,0\nFlat 3,,0,,,Vacant,0,0\n';

  function downloadTemplate(kind) {
    if (kind === 'csv') {
      const a = document.createElement('a');
      a.href = 'assets/rent-roll-template.csv';
      a.download = 'laurito-rent-roll-template.csv';
      a.click();
      return;
    }
    loadXlsx().then(function () {
      const grid = templateRows();
      const ws = XLSX.utils.aoa_to_sheet(grid);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Rent roll');
      XLSX.writeFile(wb, 'laurito-rent-roll-template.xlsx');
    }).catch(function (e) { alert(e.message); });
  }

  function applyToModel(roll, useEstimate) {
    if (typeof UW === 'undefined' || !UW.state) return;
    const s = summarise(roll.lines);
    const revenue = useEstimate && s.estimatedStabilisedPa != null ? s.estimatedStabilisedPa : s.passingPa;
    const homes = s.homes || 1;
    UW.state.income_mode = 'direct';
    UW.state.rent_status = 'Quoted';
    UW.state.rows = [{ tenure: 'Rent', units: homes, beds: '', omv: UW.state.rows && UW.state.rows[0] ? (+UW.state.rows[0].omv || 0) : 0, annualRent: homes ? revenue / homes : 0 }];
    UW.state.prefill_note = useEstimate
      ? 'Rental revenue is an estimate: uploaded passing rents plus vacant homes at the average passing rent. Not an ONS figure.'
      : 'Rental revenue is the uploaded tenancy schedule (passing rent only). Vacant homes are at £0. Service charge is not included. Not an ONS or LHA figure.';
    UW.rentRoll = { file: roll.file, summary: s, lines: roll.lines, period: roll.period, useEstimate: !!useEstimate };
    if (typeof uwUnitRows === 'function') uwUnitRows();
    const mode = document.getElementById('uw_income_mode');
    if (mode) mode.value = 'direct';
    const status = document.getElementById('uw_rent_status');
    if (status) status.value = 'Quoted';
    if (typeof uwStore === 'function') uwStore();
    if (typeof uwUpdate === 'function') uwUpdate();
    drawBridge();
  }

  function compsMedian(pc) {
    const line = typeof lcPpdLine === 'function' ? lcPpdLine(pc) : '';
    const stat = typeof lcPpdFlat === 'function' ? lcPpdFlat(pc) : null;
    return Promise.resolve({ text: line, median: stat && stat.median, n: stat && stat.n, year: stat && stat.year });
  }

  function drawBridge() {
    const host = document.getElementById('rr_bridge');
    const roll = typeof UW !== 'undefined' && UW.rentRoll;
    if (!host) return;
    if (!roll) { host.innerHTML = ''; return; }
    const s = roll.summary;
    const pc = (typeof UW !== 'undefined' && UW.state && UW.state.pc) || '';
    const model = (typeof UW !== 'undefined' && UW.result && !(UW.result.errors && UW.result.errors.length)) ? UW.result : null;
    host.innerHTML = '<div class="card"><h3>Pricing bridge from the uploaded schedule</h3><p class="foot">File: ' + esc(roll.file) + '. Figures below the schedule line are estimates. Nothing here is an ONS average.</p>' +
      '<p><span class="lc-k">Fact</span> <b>Passing rent</b> ' + money(s.passingPa) + ' a year from ' + s.letHomes + ' let home' + (s.letHomes === 1 ? '' : 's') + '. ' + s.voidHomes + ' vacant. Occupancy ' + (s.occupancy == null ? 'Unknown' : Math.round(s.occupancy * 100) + '%') + '.</p>' +
      '<p><span class="lc-k">Fact</span> Service charge ' + money(s.servicePa) + ' a year and other income ' + money(s.otherPa) + ' a year are <b>not</b> in the rent the model is using.</p>' +
      '<p><span class="lc-k">' + (s.ervStabilisedPa == null ? 'Estimate' : 'Fact') + '</span> <b>Stabilised rent</b> ' + (roll.useEstimate ? money(s.estimatedStabilisedPa) + ' a year, by putting the average passing rent on vacant homes. This is an estimate, not a new letting.' : (s.ervStabilisedPa == null ? 'Unknown. The sheet has no ERV for every vacant home, and the estimate is not switched on.' : money(s.ervStabilisedPa) + ' a year, using ERV on the sheet for vacant homes and passing rent for let homes.')) + '</p>' +
      '<p><span class="lc-k">Unknown</span> <b>Break-up value</b> is unknown. A rent roll does not value selling the homes separately.</p>' +
      '<p id="rr_as_is"><span class="lc-k">Estimate</span> <b>As-is value</b> is loading from Price Paid where the deal has a postcode.</p>' +
      '<p><span class="lc-k">Estimate</span> <b>Maximum bid</b> ' + (model ? money(model.bid) + ' at the target entry yield on the rent now in the model (' + money(model.annualRent) + ' a year, NOI ' + money(model.noi) + '). This is the model, not a valuation. Exit yield stays an assumption.' : 'Enter the remaining underwriting inputs (OPEX margin and the rest). The bid appears when the model can run.') + '</p>' +
      '<div class="scroll" style="max-height:280px"><table><thead><tr><th class="l">Unit</th><th class="l">Tenant</th><th>Status</th><th>Rent / year</th><th>Start</th><th>End</th></tr></thead><tbody>' +
      roll.lines.map(function (r) {
        return '<tr><td class="l">' + esc(r.unit) + '</td><td class="l">' + esc(r.tenant || '—') + '</td><td>' + esc(r.status) + '</td><td>' + money(r.rentPa) + '</td><td>' + esc(r.start || '—') + '</td><td>' + esc(r.end || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    const box = document.getElementById('rr_as_is');
    if (box && pc) {
      compsMedian(pc).then(function (c) {
        if (!c.median) {
          box.innerHTML = '<span class="lc-k">Estimate</span> <b>As-is value</b> Unknown from these comps. ' + esc(c.text || 'No sector median for this postcode.');
          return;
        }
        const gross = s.passingPa / (c.median * s.homes);
        box.innerHTML = '<span class="lc-k">Estimate</span> <b>As-is</b> sector flat median ' + money(c.median) + (c.year ? ' (' + esc(c.year) + ', n=' + c.n + ')' : '') + '. ' + s.homes + ' homes × that median = ' + money(c.median * s.homes) + '. That is not a survey. Implied gross yield on that figure, using passing rent only, is ' + (gross * 100).toFixed(1) + '%. ' + esc(c.text || '');
      });
    } else if (box) box.innerHTML = '<span class="lc-k">Unknown</span> <b>As-is value</b> needs a postcode on the deal. No yield is calculated.';
  }

  function mappingForm(grid, detected) {
    const headerAt = detected.headerAt;
    const headers = (grid[headerAt] || []).map(function (h, i) { return { i: i, h: String(h || '').trim() || ('Column ' + (i + 1)) }; });
    const opts = '<option value="-1">Not in this sheet</option>' + headers.map(function (h) { return '<option value="' + h.i + '">' + esc(h.h) + '</option>'; }).join('');
    return '<div id="rr_map"><p><b>Check the columns.</b> ' + (detected.needsMap ? 'The rent column is missing or ambiguous, so choose it before the model uses the sheet.' : 'These are the columns we recognised. Change any that look wrong.') + '</p>' +
      '<div class="dlgrid">' + FIELDS.map(function (f) {
        return '<label class="dlf"><small>' + esc(f[1]) + '</small><select data-field="' + f[0] + '">' + opts + '</select></label>';
      }).join('') +
      '<label class="dlf"><small>Rent amounts are</small><select id="rr_period"><option value="pcm">£ per month</option><option value="pa">£ per year</option><option value="pw">£ per week</option></select></label></div>' +
      '<label class="foot"><input type="checkbox" id="rr_stab"> Estimate stabilised rent by applying the average passing rent to vacant homes. Leave this off unless you want that estimate in the model.</label>' +
      '<div class="ctl"><button class="btn" id="rr_apply" type="button">Use this schedule as rental revenue</button><button class="btn sec" id="rr_clear" type="button">Remove schedule</button></div></div>';
  }

  function readMapping() {
    const map = {};
    document.querySelectorAll('#rr_map select[data-field]').forEach(function (sel) { map[sel.dataset.field] = +sel.value; });
    return { map: map, period: document.getElementById('rr_period').value, useEstimate: document.getElementById('rr_stab').checked, headerAt: window.RR.headerAt };
  }

  function showParsed(grid, fileName) {
    const headerAt = headerRowIndex(grid);
    const headers = grid[headerAt] || [];
    const detected = detectMap(headers);
    detected.headerAt = headerAt;
    window.RR.headerAt = headerAt;
    window.RR.grid = grid;
    window.RR.file = fileName;
    const host = document.getElementById('rr_work');
    host.innerHTML = '<p class="foot">' + esc(fileName) + ' · ' + Math.max(0, grid.length - headerAt - 1) + ' data rows under the header on row ' + (headerAt + 1) + '.</p>' + mappingForm(grid, detected);
    FIELDS.forEach(function (f) {
      const sel = host.querySelector('select[data-field="' + f[0] + '"]');
      if (sel && detected.map[f[0]] >= 0) sel.value = String(detected.map[f[0]]);
    });
    const period = host.querySelector('#rr_period');
    if (period) period.value = detected.period;
    host.querySelector('#rr_apply').onclick = function () {
      const chosen = readMapping();
      const roll = buildRoll(grid, { map: chosen.map, headerAt: headerAt }, chosen.period);
      roll.file = fileName;
      if (!roll.lines.length) { host.insertAdjacentHTML('beforeend', '<p>No data rows under that header.</p>'); return; }
      applyToModel(roll, chosen.useEstimate);
    };
    host.querySelector('#rr_clear').onclick = clearRoll;
  }

  function clearRoll() {
    if (typeof UW !== 'undefined') UW.rentRoll = null;
    const host = document.getElementById('rr_work');
    if (host) host.innerHTML = '<p class="foot">No schedule in this session. The underwrite below still uses whatever rent you type, or LHA if you explicitly choose that.</p>';
    const bridge = document.getElementById('rr_bridge');
    if (bridge) bridge.innerHTML = '';
  }

  function mount() {
    const body = document.getElementById('deal_body');
    if (!body || document.getElementById('rr_card')) return;
    const card = document.createElement('div');
    card.id = 'rr_card';
    card.className = 'card';
    card.innerHTML = '<h2>Tenancy schedule</h2><p class="lead">Drop the rent roll you already keep. Those rents become the rental revenue for this deal. ONS averages are not used. The file stays in this browser.</p>' +
      '<div class="ctl"><label class="btn">Upload Excel or CSV<input id="rr_file" type="file" accept=".xlsx,.xls,.csv,application/vnd.ms-excel,text/csv" hidden></label>' +
      '<button class="btn sec" id="rr_tpl_csv" type="button">Download template (CSV)</button>' +
      '<button class="btn sec" id="rr_tpl_xlsx" type="button">Download template (Excel)</button></div>' +
      '<p class="foot">Preferred columns: unit, tenant, rent (say if it is pcm or pa), lease start, lease end, status, service charge, other income. Other headers are matched where we can, and you can correct the match.</p>' +
      '<div id="rr_work"><p class="foot">No schedule in this session. The underwrite below still uses whatever rent you type, or LHA if you explicitly choose that.</p></div><div id="rr_bridge"></div>';
    body.insertBefore(card, body.firstChild);
    card.querySelector('#rr_tpl_csv').onclick = function () { downloadTemplate('csv'); };
    card.querySelector('#rr_tpl_xlsx').onclick = function () { downloadTemplate('xlsx'); };
    card.querySelector('#rr_file').onchange = function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      document.getElementById('rr_work').innerHTML = '<p class="foot">Reading ' + esc(file.name) + '…</p>';
      gridFromFile(file).then(function (grid) { showParsed(grid, file.name); }).catch(function (err) {
        document.getElementById('rr_work').innerHTML = '<p>Could not read that file. Save it as .xlsx or .csv and try again. ' + esc(err.message) + '</p>';
      });
    };
    if (typeof UW !== 'undefined' && UW.rentRoll) drawBridge();
  }

  if (typeof uwUpdate === 'function' && !uwUpdate._rr) {
    const prevUpdate = uwUpdate;
    const wrapped = function () {
      const out = prevUpdate();
      if (typeof UW !== 'undefined' && UW.rentRoll) drawBridge();
      return out;
    };
    wrapped._rr = true;
    uwUpdate = wrapped;
  }

  const prevStart = typeof uwStart === 'function' ? uwStart : null;
  if (prevStart) {
    uwStart = async function () {
      await prevStart();
      mount();
    };
  }

  const api = { parseCsv: parseCsv, detectMap: detectMap, headerRowIndex: headerRowIndex, buildRoll: buildRoll, summarise: summarise, parseMoney: parseMoney, isVoid: isVoid, toAnnual: toAnnual };
  if (typeof globalThis !== 'undefined') globalThis.RR = api;
  if (typeof document !== 'undefined' && document.getElementById('deal_body') && document.getElementById('deal_body').childElementCount) mount();
})();
