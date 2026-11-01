/* Comps explorer: HM Land Registry Price Paid history, ONS rents, matched auction yields. */
(function () {
  'use strict';
  const TYPE_LABEL = {all: 'All existing homes', F: 'Flat', T: 'Terraced', S: 'Semi-detached', D: 'Detached'};
  const state = {summary: null, city: 'Manchester', level: 'la', area: '', type: 'all', from: '2016', to: '2026', q: '', sales: {}, yields: null, rents: null, lha: null, checks: null};

  function esc(s) {
    return (typeof window.esc === 'function') ? window.esc(s) : String(s == null ? '' : s);
  }
  function money(n) {
    if (n == null || !isFinite(+n)) return 'Withheld';
    return '£' + Math.round(+n).toLocaleString('en-GB');
  }
  function sectorOf(pc) {
    if (typeof secOf === 'function') {
      try { const s = secOf(pc); if (s) return s; } catch (e) {}
    }
    const parts = String(pc || '').toUpperCase().trim().split(/\s+/);
    return parts.length === 2 && parts[1] ? parts[0] + ' ' + parts[1][0] : '';
  }
  function cityForPc(pc) {
    const d = String(pc || '').toUpperCase().split(/\s+/)[0];
    const places = state.summary && state.summary.places;
    if (!places) return null;
    if (/^GL5[0-4]/.test(d) && places.Cheltenham && places.Cheltenham.postcode_districts[d]) return 'Cheltenham';
    if (/^BS/.test(d) && places.Bristol && places.Bristol.postcode_districts[d]) return 'Bristol';
    if (/^M/.test(d) && places.Manchester && places.Manchester.postcode_districts[d]) return 'Manchester';
    for (const name of Object.keys(places)) {
      if (places[name].postcode_districts[d]) return name;
    }
    return null;
  }

  function statLine(label, stat, yearNote) {
    if (!stat) return label + ': no sales in this cut.';
    const band = stat.median == null ? 'median withheld (fewer than 5)' : ('median ' + money(stat.median) + (stat.p25 != null ? ', middle 50% ' + money(stat.p25) + ' to ' + money(stat.p75) : ''));
    const conf = stat.n < 5 ? 'too few to quote' : (stat.thin ? 'thin sample' : 'sample large enough to quote a median');
    return label + ' ' + (yearNote || '') + ': n=' + stat.n + ', ' + band + ' (' + conf + '). Nominal recorded prices, not a surveyor value.';
  }

  function flatStats(pc) {
    if (!state.summary || !pc) return null;
    const city = cityForPc(pc);
    if (!city) return null;
    const place = state.summary.places[city];
    const sec = sectorOf(pc);
    const dist = String(pc).toUpperCase().split(/\s+/)[0];
    const node = (sec && place.postcode_sectors[sec]) || place.postcode_districts[dist];
    if (!node) return null;
    const years = Object.keys(node).filter(function (y) { return node[y] && node[y].F && node[y].F.median != null; }).sort();
    if (!years.length) return null;
    const year = years[years.length - 1];
    const complete = years.filter(function (y) { return y !== String(new Date().getFullYear()); });
    const use = complete.length ? complete[complete.length - 1] : year;
    return { city: city, where: (sec && place.postcode_sectors[sec]) ? sec : dist, year: use, median: node[use].F.median, n: node[use].F.n, thin: !!node[use].F.thin };
  }
  window.lcPpdFlat = flatStats;

  window.lcPpdLine = function (pc) {
    if (!state.summary || !pc) return '';
    const city = cityForPc(pc);
    if (!city) return 'This postcode is not in the Manchester, Cheltenham or Bristol Price Paid extract, so no local history is attached.';
    const place = state.summary.places[city];
    const sec = sectorOf(pc);
    const dist = String(pc).toUpperCase().split(/\s+/)[0];
    const years = Object.keys((sec && place.postcode_sectors[sec]) || place.postcode_districts[dist] || {}).sort();
    const node = (sec && place.postcode_sectors[sec]) || place.postcode_districts[dist];
    if (!node) return '';
    const where = (sec && place.postcode_sectors[sec]) ? ('postcode sector ' + sec) : ('postcode district ' + dist);
    const usable = years.filter(function (y) { return node[y] && ((node[y].F && node[y].F.n >= 5) || (node[y].all && node[y].all.n >= 5)); });
    const pick = usable.slice(-2);
    if (!pick.length) return where + ' in ' + city + ' has fewer than 5 standard existing-home sales in every year we hold. Median withheld.';
    return pick.map(function (y) {
      const partial = y === String(new Date().getFullYear()) ? ' (year to date, registration lag)' : '';
      const flats = node[y].F && node[y].F.n >= 5 ? statLine('Flats,', node[y].F, y + partial) : 'Flats ' + y + ': median withheld (fewer than 5).';
      const all = node[y].all ? statLine('All existing homes in the same area, houses included so this is not a flat comp,', node[y].all, y + partial) : '';
      return city + ', ' + where + '. ' + flats + (all ? ' ' + all : '');
    }).join(' ');
  };

  function ensureView() {
    if (document.getElementById('comps_view')) return;
    const sec = document.createElement('section');
    sec.id = 'comps_view';
    sec.className = 'hidden';
    sec.style.margin = '16px 24px';
    sec.innerHTML = '<div class="card"><h2>Comps: what did homes sell for, and what is the rent evidence?</h2><p class="lead">Manchester, Cheltenham and Bristol only. Sales are HM Land Registry Price Paid from 2016, standard existing homes. Rents are the ONS local-authority average, not a street comp. A yield is shown only where one public auction lot states both a price and a rent.</p><div id="comps_meta" class="foot">Loading Price Paid summary…</div><div class="ctl" style="margin-top:10px"><label>Place <select id="comp_city"></select></label><label>Cut <select id="comp_level"><option value="la">Whole local authority</option><option value="district">Postcode district</option><option value="sector">Postcode sector</option></select></label><label>Area <select id="comp_area"></select></label><label>Type <select id="comp_type"></select></label><label>From <select id="comp_from"></select></label><label>To <select id="comp_to"></select></label><input id="comp_q" placeholder="Filter area list" style="width:160px"></div><div id="comp_table"></div><div class="ctl"><button class="btn" id="comp_load" type="button">Load individual sales</button><button class="btn sec" id="comp_csv" type="button">Download this filter (CSV)</button><span class="foot" id="comp_sales_note"></span></div><div id="comp_sales"></div></div><div class="g2"><div class="card" id="comp_rents"></div><div class="card" id="comp_yields"></div></div>';
    (document.getElementById('app') || document.body).appendChild(sec);
    sec.querySelector('#comp_city').onchange = function (e) { state.city = e.target.value; state.area = ''; fillAreas(); draw(); };
    sec.querySelector('#comp_level').onchange = function (e) { state.level = e.target.value; state.area = ''; fillAreas(); draw(); };
    sec.querySelector('#comp_area').onchange = function (e) { state.area = e.target.value; draw(); };
    sec.querySelector('#comp_type').onchange = function (e) { state.type = e.target.value; draw(); };
    sec.querySelector('#comp_from').onchange = function (e) { state.from = e.target.value; draw(); };
    sec.querySelector('#comp_to').onchange = function (e) { state.to = e.target.value; draw(); };
    sec.querySelector('#comp_q').oninput = function (e) { state.q = e.target.value.trim().toUpperCase(); fillAreas(); };
    sec.querySelector('#comp_load').onclick = function () { loadSales(true); };
    sec.querySelector('#comp_csv').onclick = function () { downloadCsv(); };
    const typeSel = sec.querySelector('#comp_type');
    Object.keys(TYPE_LABEL).forEach(function (k) {
      const o = document.createElement('option');
      o.value = k; o.textContent = TYPE_LABEL[k];
      typeSel.appendChild(o);
    });
  }

  function place() {
    return state.summary && state.summary.places[state.city];
  }
  function yearsOf(node) {
    return Object.keys(node || {}).filter(function (y) { return y >= state.from && y <= state.to; }).sort();
  }
  function currentNode() {
    const p = place();
    if (!p) return null;
    if (state.level === 'la') return {label: state.city + ' local authority', years: p.local_authority};
    if (state.level === 'district') return {label: 'Postcode district ' + state.area, years: p.postcode_districts[state.area] || {}};
    return {label: 'Postcode sector ' + state.area, years: p.postcode_sectors[state.area] || {}};
  }
  function fillAreas() {
    const sel = document.getElementById('comp_area');
    if (!sel) return;
    const p = place();
    sel.innerHTML = '';
    if (!p || state.level === 'la') {
      const o = document.createElement('option');
      o.value = ''; o.textContent = 'Whole council';
      sel.appendChild(o);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    const bag = state.level === 'district' ? p.postcode_districts : p.postcode_sectors;
    const names = Object.keys(bag).filter(function (n) { return !state.q || n.indexOf(state.q) === 0 || n.indexOf(state.q) >= 0; }).sort(function (a, b) { return a.localeCompare(b, 'en-GB', {numeric: true}); });
    if (!names.includes(state.area)) state.area = names[0] || '';
    names.forEach(function (n) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n; if (n === state.area) o.selected = true;
      sel.appendChild(o);
    });
  }
  function fillYears() {
    const p = place();
    const years = p ? Object.keys(p.local_authority).sort() : [];
    ['comp_from', 'comp_to'].forEach(function (id, idx) {
      const sel = document.getElementById(id);
      if (!sel || sel.options.length) return;
      years.forEach(function (y) {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        sel.appendChild(o);
      });
      if (years.length) sel.value = idx === 0 ? years[0] : years[years.length - 1];
    });
    const from = document.getElementById('comp_from');
    const to = document.getElementById('comp_to');
    if (from && from.value) state.from = from.value;
    if (to && to.value) state.to = to.value;
  }

  function draw() {
    const host = document.getElementById('comp_table');
    const node = currentNode();
    if (!host || !node) return;
    const years = yearsOf(node.years);
    const max = Math.max.apply(null, years.map(function (y) {
      const s = node.years[y] && node.years[y][state.type];
      return s && s.median || 0;
    }).concat([1]));
    host.innerHTML = '<h3>' + esc(node.label) + ' · ' + esc(TYPE_LABEL[state.type] || state.type) + '</h3><p class="foot">' + esc(state.summary.rules) + '</p><div class="scroll"><table><thead><tr><th>Year</th><th>Sales</th><th>Median</th><th>Middle 50%</th><th>Confidence</th><th class="l">Shape</th></tr></thead><tbody>' +
      (years.length ? years.map(function (y) {
        const s = node.years[y][state.type];
        if (!s) return '';
        const conf = s.n < 5 ? 'Withheld' : (s.thin ? 'Thin sample (under 20)' : 'Quoted median');
        const partial = y === String(new Date().getFullYear()) ? ' <span class="foot">partial</span>' : '';
        const width = s.median ? Math.max(4, Math.round(100 * s.median / max)) : 0;
        return '<tr><td>' + y + partial + '</td><td>' + s.n + '</td><td>' + (s.median == null ? 'Withheld' : money(s.median)) + '</td><td>' + (s.p25 == null ? '—' : money(s.p25) + ' – ' + money(s.p75)) + '</td><td>' + conf + '</td><td class="l"><div class="comp-bar"><span style="width:' + width + '%"></span></div></td></tr>';
      }).join('') : '<tr><td colspan="6">No sales in this cut. Try the whole council or another postcode.</td></tr>') +
      '</tbody></table></div>';
    const excluded = place() && place().excluded;
    if (excluded && state.level === 'la') {
      const bits = years.map(function (y) {
        const e = excluded[y] || {};
        return y + ': ' + (e.category_b || 0) + ' category B, ' + (e.new_build || 0) + ' new-build (not in the median)';
      });
      host.insertAdjacentHTML('beforeend', '<p class="foot">Kept out of the median. ' + esc(bits.join('. ')) + '.</p>');
    }
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const head = lines.shift().split(',');
    return lines.map(function (line) {
      const cells = [];
      let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { cells.push(cur); cur = ''; }
        else cur += ch;
      }
      cells.push(cur);
      const row = {};
      head.forEach(function (h, i) { row[h] = cells[i]; });
      return row;
    });
  }

  function filteredSales(rows) {
    const node = currentNode();
    const label = node ? node.label : '';
    return rows.filter(function (r) {
      if (r.date.slice(0, 4) < state.from || r.date.slice(0, 4) > state.to) return false;
      if (state.type !== 'all' && r.type !== state.type) return false;
      if (state.level === 'district' && r.postcode.split(' ')[0] !== state.area) return false;
      if (state.level === 'sector' && r.sector !== state.area) return false;
      return true;
    });
  }

  async function loadSales(render) {
    const slug = {Manchester: 'manchester', Cheltenham: 'cheltenham', Bristol: 'bristol'}[state.city];
    if (!state.sales[slug]) {
      document.getElementById('comp_sales_note').textContent = 'Loading ' + state.city + ' sales…';
      const res = await fetch('comps/sales_' + slug + '.csv');
      if (!res.ok) throw new Error('sales file missing');
      state.sales[slug] = parseCsv(await res.text());
    }
    const rows = filteredSales(state.sales[slug]);
    state.lastFilter = rows;
    document.getElementById('comp_sales_note').textContent = rows.length + ' standard existing-home sales in this filter. The table shows the latest 200. The CSV is the full filter.';
    if (!render) return rows;
    const shown = rows.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 200);
    document.getElementById('comp_sales').innerHTML = '<div class="scroll" style="max-height:420px"><table><thead><tr><th>Date</th><th class="l">Address</th><th>Postcode</th><th>Type</th><th>Tenure</th><th>Price</th><th></th></tr></thead><tbody>' +
      shown.map(function (r) {
        const addr = [r.saon, r.paon, r.street].filter(Boolean).join(', ');
        const href = 'https://landregistry.data.gov.uk/data/ppi/transaction/' + encodeURIComponent(r.id) + '/current';
        return '<tr><td>' + esc(r.date) + '</td><td class="l">' + esc(addr) + '</td><td>' + esc(r.postcode) + '</td><td>' + esc(TYPE_LABEL[r.type] || r.type) + '</td><td>' + esc(r.tenure) + '</td><td>' + money(r.price) + '</td><td><a href="' + href + '" target="_blank" rel="noopener">Land Registry</a></td></tr>';
      }).join('') + '</tbody></table></div>';
    return rows;
  }

  function downloadCsv() {
    const rows = state.lastFilter;
    if (!rows || !rows.length) {
      document.getElementById('comp_sales_note').textContent = 'Load individual sales first, then download the filter.';
      return;
    }
    const cols = ['id', 'date', 'price', 'postcode', 'sector', 'type', 'tenure', 'paon', 'saon', 'street', 'local_authority'];
    const csv = [cols.join(',')].concat(rows.map(function (r) {
      return cols.map(function (c) {
        const v = r[c] == null ? '' : String(r[c]);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    })).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
    a.download = 'laurito-comps-' + state.city.toLowerCase() + '.csv';
    a.click();
  }

  function drawRents() {
    const host = document.getElementById('comp_rents');
    if (!host || !state.rents) return;
    const map = {Manchester: 'Manchester', Cheltenham: 'Cheltenham', Bristol: 'Bristol, City of'};
    const area = state.rents.areas[map[state.city]];
    const brma = {Manchester: ['Central Greater Manchester', 'Southern Greater Manchester'], Cheltenham: ['Cheltenham'], Bristol: ['Bristol']};
    const rates = (state.lha && state.lha.rates || []).filter(function (r) { return (brma[state.city] || []).indexOf(r.name) >= 0; });
    host.innerHTML = '<h3>Rent benchmarks, not a rent for this street</h3><p class="foot">' + esc(state.rents.source) + '. ' + esc(state.rents.note) + ' Geography is the local authority. There is no official postcode-district private rent in this dataset.</p>' +
      (area ? '<table><thead><tr><th>ONS measure</th><th>£ / month</th></tr></thead><tbody><tr><td>All private rents</td><td>' + money(area.all) + '</td></tr><tr><td>1 bedroom</td><td>' + money(area.b1) + '</td></tr><tr><td>2 bedroom</td><td>' + money(area.b2) + '</td></tr><tr><td>3 bedroom</td><td>' + money(area.b3) + '</td></tr></tbody></table><p class="foot">Month: ' + esc(area.month) + '. 2-bed annual change ' + (area.b2_annual_change == null ? 'Unknown' : area.b2_annual_change + '%') + '. This is not a comparable for one building.</p>' : '<p>No ONS figure loaded.</p>') +
      '<h3>LHA is a benefit cap</h3><p class="foot">Local Housing Allowance, ' + esc(state.lha && state.lha.period || '') + ', by broad rental market area. It is not bankable rent and not an ONS rent. Confirm the postcode on LHA Direct before using a rate.</p>' +
      rates.map(function (r) {
        const m = r.monthly || {};
        return '<p><b>' + esc(r.name) + '</b> £/month: shared ' + (m.shared == null ? 'Unknown' : money(m.shared)) + ', 1-bed ' + money(m['1']) + ', 2-bed ' + money(m['2']) + ', 3-bed ' + money(m['3']) + ', 4-bed ' + money(m['4']) + '.</p>';
      }).join('');
  }

  function drawYields() {
    const host = document.getElementById('comp_yields');
    if (!host || !state.yields) return;
    const rows = (state.yields.rows || []).filter(function (r) { return r.city === state.city; });
    const area = state.level === 'la' ? '' : state.area;
    const matched = rows.filter(function (r) {
      const pc = String(r.postcode || '').toUpperCase();
      if (!area) return true;
      if (state.level === 'district') return pc.split(' ')[0] === area;
      return sectorOf(pc) === area;
    });
    host.innerHTML = '<h3>Yield evidence: price and income on the same lot</h3><p class="foot">' + esc(state.yields.rule) + '</p>' +
      (matched.length ? '<div class="scroll" style="max-height:360px"><table><thead><tr><th>Sold</th><th class="l">Lot</th><th>Price</th><th>Rent / year</th><th>Gross</th><th>Basis</th></tr></thead><tbody>' +
        matched.map(function (r) {
          return '<tr><td>' + esc(r.sold_date || 'Unknown') + '</td><td class="l"><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.address) + '</a><div class="foot">' + esc(r.postcode || '') + ' · ' + esc(r.auctioneer || '') + '</div></td><td>' + money(r.sold_price) + '</td><td>' + money(r.rent_pa) + '</td><td>' + (r.gross_yield * 100).toFixed(1) + '%</td><td>' + esc(r.rent_basis) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="foot">' + matched.length + ' lot' + (matched.length === 1 ? '' : 's') + ' in this cut. ' + (matched.length < 5 ? 'Fewer than 5, so this is not a sector yield.' : 'You may read these together, but they are still lot evidence, not an index.') + '</p>' : '<p>No lot in this cut states both a sold price and a rent. No yield is inferred from ONS rent or from LHA.</p>');
  }

  async function renderComps() {
    ensureView();
    if (!state.summary) {
      const res = await fetch('comps/summary.json');
      if (!res.ok) {
        document.getElementById('comps_meta').textContent = 'Price Paid summary is not in this copy of the site. Run python3 scripts/refresh_comps.py and reload.';
        return;
      }
      state.summary = await res.json();
      const [rents, lha, yields] = await Promise.all([
        fetch('rents.json').then(function (r) { return r.json(); }),
        fetch('underwriting_lha.json').then(function (r) { return r.json(); }),
        fetch('comps/yields.json').then(function (r) { return r.ok ? r.json() : {rows: [], rule: ''}; })
      ]);
      state.rents = rents; state.lha = lha; state.yields = yields;
      const citySel = document.getElementById('comp_city');
      Object.keys(state.summary.places).forEach(function (name) {
        const o = document.createElement('option');
        o.value = name; o.textContent = name;
        citySel.appendChild(o);
      });
      fillYears();
      document.getElementById('comps_meta').textContent = 'Retrieved ' + state.summary.retrieved + '. ' + state.summary.licence + ' Files: ' + state.summary.files.join(', ') + '.';
    }
    fillAreas();
    draw();
    drawRents();
    drawYields();
  }

  function openForPostcode(pc) {
    const city = cityForPc(pc);
    const sec = sectorOf(pc);
    if (city) state.city = city;
    if (sec && state.summary && state.summary.places[state.city] && state.summary.places[state.city].postcode_sectors[sec]) {
      state.level = 'sector';
      state.area = sec;
    }
    if (typeof viewMode === 'function') viewMode('comps');
    const level = document.getElementById('comp_level');
    const citySel = document.getElementById('comp_city');
    if (citySel) citySel.value = state.city;
    if (level) level.value = state.level;
    fillAreas();
    const area = document.getElementById('comp_area');
    if (area && state.area) area.value = state.area;
    draw();
    drawRents();
    drawYields();
    const view = document.getElementById('comps_view');
    if (view) view.scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function mount() {
    ensureView();
    if (typeof NAVG !== 'undefined' && NAVG.find && !NAVG.find[1].some(function (x) { return x[0] === 'comps'; })) {
      const at = NAVG.find[1].findIndex(function (x) { return x[0] === 'valuation'; });
      NAVG.find[1].splice(at >= 0 ? at : 1, 0, ['comps', 'Comps']);
    }
    if (typeof viewMode === 'function' && !viewMode._comps) {
      const prev = viewMode;
      const wrapped = function (mode) {
        const v = document.getElementById('comps_view');
        if (v) v.classList.toggle('hidden', mode !== 'comps');
        prev(mode);
        if (mode === 'comps') renderComps().catch(function (e) { console.log('comps', e); });
      };
      wrapped._comps = true;
      viewMode = wrapped;
    }
    const active = document.querySelector('#subnav .subb.on');
    if (typeof navSync === 'function') navSync(active ? active.dataset.v : 'distress');
    renderComps().catch(function (e) { console.log('comps', e); });
    document.addEventListener('click', function (e) {
      const b = e.target.closest('[data-comps-pc]');
      if (!b) return;
      e.preventDefault();
      renderComps().then(function () { openForPostcode(b.getAttribute('data-comps-pc')); });
    });
    fetch('comps/listing_checks.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      state.checks = data;
      if (document.querySelector('#sales_body article')) annotateListings();
      if (typeof sfRender === 'function' && !sfRender._checks) {
        const prev = sfRender;
        const wrapped = function () {
          prev();
          annotateListings();
        };
        wrapped._checks = true;
        sfRender = wrapped;
      }
    }).catch(function () {});
  }

  function annotateListings() {
    if (!state.checks || !state.checks.rows) return;
    const byUrl = {};
    state.checks.rows.forEach(function (r) { byUrl[r.url] = r; });
    document.querySelectorAll('#sales_body article a[href]').forEach(function (a) {
      const rec = byUrl[a.href] || byUrl[a.getAttribute('href')];
      if (!rec || a.dataset.checked) return;
      a.dataset.checked = '1';
      const note = document.createElement('p');
      note.className = 'foot';
      note.textContent = 'Link check ' + (rec.checked_at || '') + ': HTTP ' + (rec.http == null ? 'no response' : rec.http) + '. ' + (rec.note || '');
      a.insertAdjacentElement('afterend', note);
    });
  }

  if (typeof document !== 'undefined') mount();
})();
