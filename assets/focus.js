/* One headline per screen. Everything else stays, behind a labelled expander. */
(function () {
  'use strict';

  const PRIMARY = [
    ['assets', 'Find'],
    ['distress', 'Leads'],
    ['auctions', 'Auctions'],
    ['deal', 'Deal'],
    ['comps', 'Comps']
  ];
  const MORE = [
    ['map', 'Map'],
    ['sales', 'For sale now'],
    ['valuation', 'Local OMV / LHA'],
    ['accom', 'Demand'],
    ['pipeline', 'Pipeline'],
    ['shortlist', 'Shortlist'],
    ['overview', 'Overview']
  ];
  const COPY = {
    assets: ['Find', 'Where to look', 'Manchester, Cheltenham, Bristol and Edinburgh. Open a town, then a lead, then a deal.'],
    distress: ['Leads', 'Who has to sell', 'A is a live insolvency. B is a lender or receiver sale. C is a watchlist, not a forced sale.'],
    sales: ['Leads', 'For sale now', 'Checked listings only. An empty list is not proof that nothing is for sale.'],
    deal: ['Deal', 'The decision', 'Rent, operating income, the NIY you are using, the maximum bid, and the return.'],
    comps: ['Comps', 'What sold nearby', 'Land Registry prices for this town. A yield is shown only when the same lot states rent and price.'],
    map: ['Find', 'Map', 'One town at a time. Colour is a screen, not a valuation.'],
    valuation: ['Comps', 'Local sold evidence', 'Cohort medians. Local Housing Allowance here is a benefit cap, not a rent.'],
    accom: ['More', 'Demand', 'Published temporary accommodation and asylum figures. Not a lease.'],
    pipeline: ['More', 'Pipeline', 'Stages kept in this browser.'],
    shortlist: ['More', 'Shortlist', 'Sites you marked, in this browser.'],
    overview: ['More', 'Overview', 'A count of the book, not a recommendation.']
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function money(n) {
    if (n == null || !isFinite(+n)) return '—';
    return '£' + Math.round(+n).toLocaleString('en-GB');
  }
  function rate(n) {
    if (n == null || !isFinite(+n)) return '—';
    return (Math.abs(n) <= 2 ? n * 100 : n).toFixed(1) + '%';
  }

  function installNav() {
    const bar = document.querySelector('.mainnav');
    if (!bar || bar.dataset.focus) return;
    const partner = document.querySelector('#nav2 a.mainb');
    const partnerHref = partner ? partner.href : 'https://pgraham974.github.io/ecosystem-partners/';
    bar.dataset.focus = '1';
    bar.innerHTML = PRIMARY.map(function (pair) {
      return '<button class="mainb" type="button" data-v="' + pair[0] + '">' + pair[1] + '</button>';
    }).join('') +
      '<div class="lc-more"><button class="mainb" type="button" id="lc_more_btn" aria-expanded="false">More</button>' +
      '<div class="lc-more-menu" hidden>' +
      MORE.map(function (pair) {
        return '<button type="button" data-v="' + pair[0] + '">' + pair[1] + '</button>';
      }).join('') +
      '<a href="' + esc(partnerHref) + '" target="_blank" rel="noopener">Partner site</a></div></div>';
    bar.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-v]');
      if (!btn || !bar.contains(btn)) return;
      e.preventDefault();
      closeMore();
      if (typeof viewMode === 'function') viewMode(btn.getAttribute('data-v'));
    });
    const more = document.getElementById('lc_more_btn');
    more.addEventListener('click', function (e) {
      e.stopPropagation();
      const menu = more.nextElementSibling;
      const open = menu.hasAttribute('hidden');
      if (open) menu.removeAttribute('hidden'); else menu.setAttribute('hidden', '');
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.lc-more')) closeMore();
    });
    const sub = document.getElementById('subnav');
    if (sub) sub.hidden = true;
  }

  function closeMore() {
    const menu = document.querySelector('.lc-more-menu');
    const btn = document.getElementById('lc_more_btn');
    if (menu) menu.setAttribute('hidden', '');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function markNav(mode) {
    document.querySelectorAll('.mainnav .mainb[data-v]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-v') === mode);
    });
    const moreOn = MORE.some(function (pair) { return pair[0] === mode; });
    const moreBtn = document.getElementById('lc_more_btn');
    if (moreBtn) moreBtn.classList.toggle('on', moreOn);
  }

  function screenHost() {
    let host = document.getElementById('lc_screen');
    if (host) return host;
    host = document.createElement('section');
    host.id = 'lc_screen';
    host.className = 'lc-screen';
    const nav = document.getElementById('nav2');
    if (nav && nav.parentNode) nav.parentNode.insertBefore(host, nav.nextSibling);
    else document.body.insertBefore(host, document.body.firstChild);
    return host;
  }

  function leadCounts() {
    const sites = (window.DM && DM.sites) || [];
    const n = function (kind) { return sites.filter(function (s) { return s.kind === kind; }).length; };
    if (!sites.length) return [];
    return [
      { n: n('d'), l: 'A sites' },
      { n: n('lot'), l: 'B sales' },
      { n: n('pre') + n('s'), l: 'C watchlist' },
      { n: n('sale'), l: 'Ordinary sales' }
    ];
  }

  function findCounts() {
    const sites = (window.DM && DM.sites) || [];
    const towns = [['Manchester', 'Manchester'], ['Cheltenham', 'Cheltenham'], ['City Of Bristol', 'Bristol'], ['Edinburgh', 'Edinburgh']];
    if (!sites.length) return [];
    return towns.map(function (t) {
      return {
        n: sites.filter(function (s) { return s.city === t[0] && (s.kind === 'd' || s.kind === 'lot'); }).length,
        l: t[1] + ' A/B'
      };
    });
  }

  function dealCounts() {
    const r = (typeof UW !== 'undefined' && UW.result && !(UW.result.errors && UW.result.errors.length)) ? UW.result : null;
    const niy = (typeof UW !== 'undefined' && UW.state) ? UW.state.entryYield : null;
    const mode = (typeof UW !== 'undefined' && UW.state && UW.state.niyMode === 'average' && !UW.state.niyUserOverride) ? ' area' : '';
    if (!r) return [{ n: '—', l: 'Needs rent and OPEX' }];
    const irr = r.levered && r.levered.irr;
    const mult = r.levered && r.levered.multiple;
    return [
      { n: money(r.annualRent), l: 'Rent' },
      { n: money(r.noi), l: 'NOI' },
      { n: (niy == null ? '—' : Number(niy).toFixed(2) + '%') + mode, l: 'NIY used' },
      { n: money(r.bid), l: 'Max bid' },
      { n: rate(irr), l: 'Levered IRR' },
      { n: (mult == null || !isFinite(+mult) ? '—' : Number(mult).toFixed(2) + '×'), l: 'Multiple' }
    ];
  }

  const YIELD = { Manchester: '…', Cheltenham: '…', Bristol: '…', Edinburgh: 'Not loaded' };
  let dealStep = 0;

  function compact(n) {
    if (n == null || !isFinite(+n)) return '—';
    const sign = n < 0 ? '−' : '';
    const a = Math.abs(n);
    if (a >= 1000000) {
      const m = a / 1000000;
      const text = m >= 10 ? m.toFixed(1) : m.toFixed(1);
      return sign + '£' + text.replace(/\.0$/, '') + 'm';
    }
    if (a >= 10000) return sign + '£' + Math.round(a / 1000) + 'k';
    return sign + '£' + Math.round(a).toLocaleString('en-GB');
  }
  function pct1(n) {
    if (n == null || !isFinite(+n)) return '—';
    const v = Math.abs(n) <= 2 ? n * 100 : n;
    return v.toFixed(1) + '%';
  }

  function loadYields() {
    fetch('comps/area-yields.json').then(function (r) { return r.json(); }).then(function (data) {
      function mean(city, setId) {
        const rows = (data.rows || []).filter(function (row) { return row.city === city && row.set_id === setId && row.in_average; });
        if (rows.length < 2) return null;
        return rows.reduce(function (sum, row) { return sum + Number(row.yield_pct); }, 0) / rows.length;
      }
      const sold = mean('Manchester', 'manchester-office-sold');
      const asking = mean('Cheltenham', 'cheltenham-office-asking');
      YIELD.Manchester = sold ? sold.toFixed(1) + '% sold' : 'No sold average';
      YIELD.Cheltenham = asking ? asking.toFixed(1) + '% asking' : 'No asking average';
      YIELD.Bristol = '9% asking, one lot';
      if (document.body.classList.contains('ios-find')) paintFind();
    }).catch(function () {});
  }

  function leadCount(city) {
    const sites = (window.DM && DM.sites) || [];
    if (!sites.length) return null;
    return sites.filter(function (s) { return s.city === city && (s.kind === 'd' || s.kind === 'lot'); }).length;
  }

  function openCity(city) {
    if (window.DM) DM.scope = city;
    viewMode('distress');
    const sel = document.getElementById('dm_scope');
    if (sel) {
      sel.value = city;
      sel.dispatchEvent(new Event('change'));
    }
  }

  function paintFind() {
    const towns = [['Manchester', 'Manchester'], ['Cheltenham', 'Cheltenham'], ['City Of Bristol', 'Bristol'], ['Edinburgh', 'Edinburgh']];
    const host = screenHost();
    host.innerHTML = '<p class="lc-kicker">Find</p><h1>Choose a town</h1><p class="lc-purpose">Tap a town to see who has to sell there.</p><div class="ios-cities">' +
      towns.map(function (t) {
        const n = leadCount(t[0]);
        return '<button type="button" class="ios-city" data-city="' + esc(t[0]) + '"><span class="ios-city-name">' + esc(t[1]) + '</span><span class="ios-city-meta">' + (n == null ? 'Leads' : n + ' lead' + (n === 1 ? '' : 's')) + '</span><span class="ios-city-yield">' + esc(YIELD[t[1]] || '') + '</span></button>';
      }).join('') + '</div><button type="button" class="ios-text" id="lc_details">' + (document.body.classList.contains('ios-details') ? 'Hide details' : 'Details') + '</button>';
    host.querySelectorAll('.ios-city').forEach(function (btn) {
      btn.onclick = function () { openCity(btn.getAttribute('data-city')); };
    });
    document.getElementById('lc_details').onclick = function () {
      document.body.classList.toggle('ios-details');
      this.textContent = document.body.classList.contains('ios-details') ? 'Hide details' : 'Details';
    };
    document.body.classList.add('ios-find');
    document.body.classList.remove('ios-deal');
    markNav('assets');
  }

  function paintScreen(mode) {
    screenHost().hidden = mode === 'auctions';
    if (mode === 'auctions') { document.body.classList.remove('ios-find', 'ios-deal'); markNav(mode); return; }
    if (mode === 'assets') return paintFind();
    document.body.classList.remove('ios-find');
    if (mode === 'deal') {
      document.body.classList.add('ios-deal');
      paintDealChrome();
      markNav(mode);
      return;
    }
    document.body.classList.remove('ios-deal');
    const copy = COPY[mode] || ['More', 'More', 'The rest of the book. Nothing here is a recommendation.'];
    const stats = mode === 'distress' || mode === 'sales' ? leadCounts() : [];
    const host = screenHost();
    host.innerHTML = '<p class="lc-kicker">' + esc(copy[0]) + '</p><h1>' + esc(copy[1]) + '</h1><p class="lc-purpose">' + esc(copy[2]) + '</p>' +
      (stats.length ? '<div class="lc-stats">' + stats.map(function (s) {
        return '<div><b>' + esc(s.n) + '</b><span>' + esc(s.l) + '</span></div>';
      }).join('') + '</div>' : '');
    markNav(mode);
  }

  function fold(el, label) {
    if (!el || el.closest('details.lc-fold')) return;
    const details = document.createElement('details');
    details.className = 'lc-fold';
    const summary = document.createElement('summary');
    summary.textContent = label;
    details.appendChild(summary);
    el.parentNode.insertBefore(details, el);
    details.appendChild(el);
  }

  function clipLong(root) {
    if (!root) return;
    root.querySelectorAll('p, .foot').forEach(function (p) {
      if (p.dataset.clipped || p.closest('.lc-decision, .lc-screen, details, table, .lc-stats')) return;
      if (p.querySelector('button, input, select, table')) return;
      const plain = p.textContent.replace(/\s+/g, ' ').trim();
      if (plain.length < 170) return;
      const full = p.innerHTML;
      const short = plain.slice(0, 118).replace(/\s+\S*$/, '');
      p.textContent = short + '. ';
      const details = document.createElement('details');
      details.className = 'lc-inline';
      details.innerHTML = '<summary>Full note</summary><div>' + full + '</div>';
      p.appendChild(details);
      p.dataset.clipped = '1';
    });
  }

  function foldStatic() {
    const aside = document.querySelector('aside.card');
    if (aside) fold(aside, 'Caveats');
    const legend = document.querySelector('.legend');
    if (legend) fold(legend, 'Method');
    const demand = document.getElementById('f_demand');
    if (demand) fold(demand, 'Evidence');
    const table = document.getElementById('tfun');
    if (table) fold(table.closest('.scroll') || table, 'Full table');
    const chart = document.getElementById('f_chart');
    if (chart && chart.childElementCount) fold(chart, 'Evidence');
  }

  function foldComps() {
    const table = document.getElementById('comp_table');
    if (table && table.childElementCount) fold(table, 'Full table');
    fold(document.getElementById('comp_sales'), 'Full table');
    fold(document.getElementById('comp_area_yields'), 'Evidence');
    fold(document.getElementById('comp_rents'), 'Sources');
    fold(document.getElementById('comp_yields'), 'Evidence');
    const lead = document.querySelector('#comps_view .lead');
    if (lead) clipLong(lead.parentNode);
  }

  function foldLeads() {
    const grid = document.getElementById('dm_map');
    if (grid && !grid.closest('details.lc-fold')) {
      fold(grid, 'Full map');
      const details = grid.closest('details.lc-fold');
      if (details && !details.dataset.map) {
        details.dataset.map = '1';
        details.addEventListener('toggle', function () {
          if (details.open && window.DM && DM.map && DM.map.invalidateSize) DM.map.invalidateSize();
        });
      }
    }
    const intro = document.querySelector('#distress_view .ctl .foot');
    if (intro && intro.parentElement) clipLong(intro.parentElement);
  }

  function foldNiy() {
    const box = document.getElementById('niy_box');
    if (!box || box.querySelector(':scope > details.ios-disc')) return;
    const keep = new Set();
    const heading = box.querySelector('h3');
    const radios = box.querySelector('.ctl');
    const select = box.querySelector('select');
    if (heading) keep.add(heading);
    if (radios) keep.add(radios);
    if (select && select.closest('label')) keep.add(select.closest('label'));
    const extra = [...box.children].filter(function (child) { return !keep.has(child) && child.tagName !== 'DETAILS'; });
    if (!extra.length) return;
    const details = document.createElement('details');
    details.className = 'ios-disc';
    details.innerHTML = '<summary>Evidence</summary>';
    extra.forEach(function (child) { details.appendChild(child); });
    box.appendChild(details);
  }

  function relabel(root) {
    const map = {
      'Asset / scheme name': 'Name',
      'City': 'Town',
      'Postcode / sector': 'Postcode',
      'Rent-paying legal tenant': 'Who pays the rent',
      'Rent evidence': 'How sure is the rent',
      'Listing / quote source URL': 'Link',
      'Purchase price £ (0 = NIY bid)': 'Price, if you already know it',
      'Target entry NIY %': 'Yield you want, %',
      'OPEX margin % of rent': 'Running costs, % of rent',
      'Debt LTV % of purchase price': 'Loan, % of the price',
      'Interest rate % (interest only)': 'Interest rate, %',
      'Exit NOI yield % (assumption, not evidence)': 'Exit yield, %',
      'Rented-unit income basis': 'How the rent is entered',
      'BRMA for LHA benchmark': 'Benefit area',
      'Capex £ per unit, one-off': 'Works per home, £',
      'Additional scheme-level works £': 'Other works, £',
      'Annual rent £ / unit': 'Rent per year',
      'LHA category': 'Bed size',
      'Tenure': 'Type'
    };
    root.querySelectorAll('small, th, h2, h3').forEach(function (el) {
      const key = el.textContent.trim();
      if (map[key]) el.textContent = map[key];
    });
    const niy = root.querySelector('#niy_box h3');
    if (niy) niy.textContent = 'Yield you want to buy at';
    const rr = document.getElementById('rr_card');
    const h = rr && rr.querySelector('h2');
    if (h) h.textContent = 'Rent roll';
  }

  function cardWith(selector) {
    const el = document.querySelector(selector);
    return el ? el.closest('.card') || el : null;
  }

  function showStep(index) {
    const steps = document.querySelectorAll('#deal_body .ios-step');
    if (!steps.length) return;
    dealStep = Math.max(0, Math.min(steps.length - 1, index));
    steps.forEach(function (step, i) { step.hidden = i !== dealStep; });
    document.querySelectorAll('.ios-progress button').forEach(function (btn, i) {
      btn.classList.toggle('on', i === dealStep);
      btn.classList.toggle('done', i < dealStep);
    });
    const dealView = document.getElementById('deal_view');
    if (dealView && !dealView.classList.contains('hidden')) paintDealChrome();
    if (dealStep === 3) refreshResult();
    window.scrollTo(0, 0);
  }

  function paintDealChrome() {
    const names = ['Property', 'Rent roll', 'Assumptions', 'Your bid'];
    const host = screenHost();
    host.innerHTML = '<div class="ios-progress" role="tablist">' + names.map(function (name, i) {
      return '<button type="button" data-step="' + i + '"' + (i === dealStep ? ' class="on"' : '') + '>' + (i + 1) + ' ' + name + '</button>';
    }).join('') + '</div>';
    host.querySelectorAll('button').forEach(function (btn) {
      btn.onclick = function () { showStep(Number(btn.getAttribute('data-step'))); };
    });
  }

  function yearlyCash(result) {
    const state = UW.state || {};
    const start = Number(state.completionMonth) || 0;
    const exit = start + (Number(state.holdYears) || 0) * 12;
    const years = [];
    (result.schedule || []).forEach(function (row) {
      if (row.m <= start || row.m > exit) return;
      const index = Math.floor((row.m - start - 1) / 12);
      if (!years[index]) years[index] = { noi: 0, debt: 0, net: 0 };
      years[index].noi += Number(row.noi) || 0;
      years[index].debt += -(Number(row.interest) || 0);
      years[index].net += (Number(row.noi) || 0) + (Number(row.interest) || 0);
    });
    return years.filter(Boolean);
  }

  function chartSvg(years) {
    const width = 640, height = 280, padL = 56, padB = 36, padT = 16, padR = 12;
    const max = Math.max(1, ...years.map(function (y) { return Math.max(y.noi, y.debt, y.net, 0); }));
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const group = innerW / Math.max(years.length, 1);
    const bar = Math.min(18, group / 4);
    let ticks = '';
    for (let i = 0; i <= 4; i++) {
      const value = max * (i / 4);
      const y = padT + innerH - (value / max) * innerH;
      ticks += '<line x1="' + padL + '" y1="' + y + '" x2="' + (width - padR) + '" y2="' + y + '" stroke="#e1e7ec"/>';
      ticks += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" fill="#5c6b78" font-size="11">' + (value / 1000000).toFixed(1) + '</text>';
    }
    const series = [
      ['noi', '#021726', 'NOI'],
      ['debt', '#9DC8ED', 'Debt service'],
      ['net', '#8aa0b0', 'Net cash']
    ];
    let bars = '';
    years.forEach(function (year, i) {
      const x0 = padL + i * group + group / 2 - bar * 1.6;
      series.forEach(function (s, k) {
        const h = Math.max(0, (year[s[0]] / max) * innerH);
        const x = x0 + k * (bar + 3);
        const y = padT + innerH - h;
        bars += '<rect x="' + x + '" y="' + y + '" width="' + bar + '" height="' + h + '" fill="' + s[1] + '" rx="2"/>';
      });
      bars += '<text x="' + (padL + i * group + group / 2) + '" y="' + (height - 12) + '" text-anchor="middle" fill="#5c6b78" font-size="12">Year ' + (i + 1) + '</text>';
    });
    const legend = series.map(function (s, i) {
      return '<rect x="' + (padL + i * 150) + '" y="4" width="10" height="10" fill="' + s[1] + '"/><text x="' + (padL + 16 + i * 150) + '" y="13" fill="#021726" font-size="12">' + s[2] + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Cash flow over the hold, £ million">' + legend + ticks + bars +
      '<text x="14" y="' + (height / 2) + '" transform="rotate(-90 14 ' + (height / 2) + ')" fill="#5c6b78" font-size="11">£ million</text></svg>';
  }

  function sensitivityTable(result) {
    const entry = Number(UW.state.entryYield);
    const exit = Number(UW.state.exitYield);
    if (!isFinite(entry) || !isFinite(exit)) return '<p>Set a yield to see the grid.</p>';
    const rows = [entry - 1, entry, entry + 1];
    const cols = [exit - 0.5, exit, exit + 0.5];
    let html = '<p class="lc-purpose">Maximum bid. Down the side is the yield you buy at. Across is the exit yield.</p><table class="ios-grid"><thead><tr><th>Buy at</th>' + cols.map(function (c) {
      return '<th>' + c.toFixed(1) + '%</th>';
    }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (row) {
      html += '<tr><th>' + row.toFixed(2) + '%</th>';
      cols.forEach(function (col) {
        const copy = Object.assign({}, UW.state, { entryYield: row, exitYield: col, rows: (UW.state.rows || []).map(function (r) { return Object.assign({}, r); }) });
        let bid = null;
        try {
          const out = UW.compute(copy);
          if (!(out.errors && out.errors.length)) bid = out.bid;
        } catch (e) {}
        const here = Math.abs(row - entry) < 0.001 && Math.abs(col - exit) < 0.001;
        html += '<td' + (here ? ' class="here"' : '') + '>' + compact(bid) + '</td>';
      });
      html += '</tr>';
    });
    return html + '</tbody></table>';
  }

  function refreshResult() {
    const host = document.getElementById('ios_result');
    if (!host || typeof UW === 'undefined') return;
    const result = UW.result;
    const ok = result && !(result.errors && result.errors.length);
    if (!ok) {
      host.innerHTML = '<p class="lc-purpose">' + esc((result && result.errors && result.errors[0]) || 'Add the rent and the running costs to see a bid.') + '</p>';
      return;
    }
    const years = yearlyCash(result);
    const mult = result.levered && result.levered.multiple;
    host.innerHTML = '<p class="ios-kicker">Your bid</p><p class="ios-hero">' + compact(result.bid) + '</p>' +
      '<div class="ios-support"><div><b>' + pct1(result.levered && result.levered.irr) + '</b><span>Levered return</span></div><div><b>' + (mult == null ? '—' : Number(mult).toFixed(2) + '×') + '</b><span>Multiple</span></div><div><b>' + compact(result.noi) + '</b><span>NOI</span></div><div><b>' + compact(result.annualRent) + '</b><span>Rent</span></div></div>' +
      '<h2 class="ios-h">Cash flow over the hold</h2>' + (years.length ? chartSvg(years) : '<p>No operating years yet.</p>') +
      '<details class="ios-disc"><summary>Bid if the yields move</summary>' + sensitivityTable(result) + '<p class="lc-purpose">Each cell is the maximum bid. The highlighted cell is the yield you entered.</p></details>' +
      '<details class="ios-disc"><summary>Where the return comes from</summary><div class="ios-returns"><div><span>Money you put in</span><b>' + compact(result.levered && result.levered.equity) + '</b></div><div><span>Profit</span><b>' + compact(result.levered && result.levered.profit) + '</b></div><div><span>Multiple</span><b>' + (mult == null ? '—' : Number(mult).toFixed(2) + '×') + '</b></div></div></details>';
  }

  function layoutDeal(body) {
    const property = cardWith('#uw_name');
    const units = cardWith('#uw_units');
    const price = cardWith('#uw_opexMargin');
    const capex = cardWith('#uw_capex');
    const timing = body.querySelector('details') ? body.querySelector('details').closest('.card') : null;
    const calc = cardWith('#uw_calculate');
    const results = document.getElementById('uw_results');
    const saved = document.getElementById('uw_saved');
    const tools = body.querySelector('.ctl');
    const rr = document.getElementById('rr_card');
    const advanced = document.createElement('details');
    advanced.className = 'ios-disc';
    advanced.innerHTML = '<summary>Advanced</summary>';
    const income = units && units.querySelector('.dlgrid');
    const lha = document.getElementById('uw_lha_reference');
    if (income) advanced.appendChild(income);
    if (lha) advanced.appendChild(lha);
    if (capex) advanced.appendChild(capex);
    if (timing && timing !== property) advanced.appendChild(timing);

    function pane(index, title, helper) {
      const step = document.createElement('section');
      step.className = 'ios-step';
      step.dataset.step = String(index);
      step.innerHTML = '<h1>' + title + '</h1><p class="lc-purpose">' + helper + '</p><div class="ios-step-body"></div><div class="ios-nav"></div>';
      return step;
    }
    const steps = [
      pane(0, 'Property', 'Name the building and the town.'),
      pane(1, 'Rent roll', 'Upload the schedule, or type the rent.'),
      pane(2, 'Assumptions', 'The yield you want to buy at, costs, loan and interest.'),
      pane(3, 'Your bid', 'What you could pay, and what it earns.')
    ];
    const bodies = steps.map(function (step) { return step.querySelector('.ios-step-body'); });
    if (property) bodies[0].appendChild(property);
    if (rr) bodies[1].appendChild(rr);
    if (units) bodies[1].appendChild(units);
    if (advanced.childElementCount > 1) bodies[1].appendChild(advanced);
    if (price) bodies[2].appendChild(price);
    const result = document.createElement('div');
    result.id = 'ios_result';
    bodies[3].appendChild(result);
    const notes = document.createElement('details');
    notes.className = 'ios-disc';
    notes.innerHTML = '<summary>Cash flow and notes</summary>';
    if (results) notes.appendChild(results);
    bodies[3].appendChild(notes);
    if (tools) bodies[3].appendChild(tools);
    if (saved) bodies[3].appendChild(saved);
    if (calc) { calc.classList.add('ios-hide'); bodies[3].appendChild(calc); }

    const wrap = document.createElement('div');
    wrap.className = 'ios-steps';
    steps.forEach(function (step, i) {
      const nav = step.querySelector('.ios-nav');
      if (i > 0) nav.innerHTML += '<button type="button" class="ios-text" data-back>Back</button>';
      if (i < 3) nav.innerHTML += '<button type="button" class="btn ios-next" data-next>' + (i === 2 ? 'See your bid' : 'Next') + '</button>';
      wrap.appendChild(step);
    });
    body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-next]')) showStep(dealStep + 1);
      if (e.target.closest('[data-back]')) showStep(dealStep - 1);
    });
    relabel(body);
    foldNiy();
    showStep(dealStep);
  }

  function parkExtras() {
    const rent = document.querySelector('.ios-step[data-step="1"] .ios-step-body');
    const assume = document.querySelector('.ios-step[data-step="2"] .ios-step-body');
    const rr = document.getElementById('rr_card');
    if (rr && rent && !rent.contains(rr)) rent.insertBefore(rr, rent.firstChild);
    const box = document.getElementById('niy_box');
    if (box && assume && !assume.contains(box)) assume.insertBefore(box, assume.firstChild);
  }

  function shapeDeal() {
    const body = document.getElementById('deal_body');
    if (!body) return;
    if (!body.querySelector('.ios-steps')) layoutDeal(body);
    else {
      relabel(body);
      parkExtras();
      foldNiy();
      refreshResult();
    }
    const dealView = document.getElementById('deal_view');
    if (dealView && !dealView.classList.contains('hidden')) {
      document.body.classList.add('ios-deal');
      document.body.classList.remove('ios-find');
      paintDealChrome();
    }
  }

  function tidy(mode) {
    installNav();
    foldStatic();
    paintScreen(mode);
    if (mode === 'comps') foldComps();
    if (mode === 'distress') foldLeads();
    if (mode === 'deal') shapeDeal();
    if (mode === 'assets') foldStatic();
    if (mode !== 'auctions') clipLong(document.getElementById(mode + '_view'));
  }

  function hook(name, after) {
    const prev = window[name];
    if (typeof prev !== 'function' || prev._focus) return;
    const wrapped = function () {
      const out = prev.apply(this, arguments);
      const run = function () { try { after(); } catch (e) { console.log('focus', e); } };
      if (out && typeof out.then === 'function') return out.then(function (v) { run(); return v; });
      run();
      return out;
    };
    wrapped._focus = true;
    window[name] = wrapped;
  }

  installNav();
  if (typeof viewMode === 'function' && !viewMode._focus) {
    const prev = viewMode;
    const wrapped = function (mode) {
      const out = prev.apply(this, arguments);
      if (mode === 'auctions' && location.hash !== '#auctions') history.replaceState(null, '', '#auctions');
      else if (mode !== 'auctions' && location.hash === '#auctions') history.replaceState(null, '', location.pathname + location.search);
      const run = function () { tidy(mode); };
      if (out && typeof out.then === 'function') return out.then(function (v) { run(); return v; });
      setTimeout(run, 0);
      return out;
    };
    wrapped._focus = true;
    viewMode = wrapped;
  }
  if (typeof navGo === 'function' && !navGo._focus) {
    const prevGo = navGo;
    const wrappedGo = function (g) {
      if (g === 'find') return viewMode('assets');
      return prevGo(g);
    };
    wrappedGo._focus = true;
    navGo = wrappedGo;
  }
  hook('uwUpdate', shapeDeal);
  hook('uwStart', function () { setTimeout(shapeDeal, 0); });
  hook('dmStart', function () {
    setTimeout(function () {
      const view = document.getElementById('distress_view');
      if (view && !view.classList.contains('hidden')) {
        foldLeads();
        paintScreen('distress');
      } else if (document.body.classList.contains('ios-find')) paintFind();
    }, 0);
  });

  loadYields();
  const watch = new MutationObserver(function () {
    if (!document.body.classList.contains('ios-deal')) return;
    const box = document.getElementById('niy_box');
    if (box && !box.querySelector(':scope > details.ios-disc')) foldNiy();
  });
  const dealBody = document.getElementById('deal_body');
  if (dealBody) watch.observe(dealBody, { childList: true, subtree: true });
  setTimeout(function () {
    if (!(window.DM && DM.sites && DM.sites.length) && typeof dmStart === 'function') {
      try { dmStart(); } catch (e) {}
      const view = document.getElementById('distress_view');
      const find = document.getElementById('assets_view');
      if (view) view.classList.add('hidden');
      if (find) find.classList.remove('hidden');
    }
    viewMode(location.hash === '#auctions' || window.lcAuctionsActive ? 'auctions' : 'assets');
  }, 0);
  let tries = 0;
  const waitSites = setInterval(function () {
    tries += 1;
    const ready = window.DM && DM.sites && DM.sites.length;
    if (!ready && tries < 25) return;
    clearInterval(waitSites);
    const title = document.querySelector('#lc_screen h1');
    if (!title) return;
    if (title.textContent === 'Where to look') paintScreen('assets');
    if (title.textContent === 'Who has to sell') paintScreen('distress');
  }, 400);
})();
