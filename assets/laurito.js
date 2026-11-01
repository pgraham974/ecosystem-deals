/* Laurito acquisition layer. Labels, deal cards, stock score and local pipeline handover.
   Loaded after index.html defines the app and before its data fetches resolve. */
(function () {
  'use strict';

  function money(n) {
    if (n == null || !isFinite(+n)) return 'Unknown';
    const fn = typeof fmt === 'function' ? fmt : function (x) { return Math.round(+x).toLocaleString('en-GB'); };
    return '£' + fn(n);
  }

  function lcBandFromSeller(s) {
    if (!s) return 'U';
    if (s.k === 'c') return 'B';
    const text = (s.label || '') + ' ' + (s.why || '');
    if (/executor|attorney/i.test(text)) return 'D';
    if (/not stated|unclear|unknown|unstated/i.test(text)) return 'U';
    return 'D';
  }

  function lcBandForProp(p) {
    if (!p) return 'U';
    if (typeof sellerOf === 'function') return lcBandFromSeller(sellerOf(p));
    const s = String(p.seller_type || '');
    if (/executor|attorney/i.test(s)) return 'D';
    if (/receiver|mortgagee|administrator|liquidator/i.test(s)) return 'B';
    if (!s || /not disclosed|unknown|not stated|unstated/i.test(s)) return 'U';
    return 'D';
  }

  function lcRoute(band, sellerText) {
    const s = String(sellerText || '');
    if (band === 'A') return 'IP';
    if (band === 'C') return 'owner';
    if (band === 'U') return 'unknown';
    if (/receiver|mortgagee/i.test(s)) return 'receiver';
    if (/administrator|liquidator/i.test(s)) return 'IP';
    if (band === 'B') return 'receiver';
    if (band === 'D') {
      if (!s || /not disclosed|unknown|not stated|unstated|executor|attorney/i.test(s)) return 'unknown';
      return 'agent';
    }
    if (/auction|agent/i.test(s)) return 'agent';
    return 'unknown';
  }

  function lcWorth(pc) {
    const out = {
      asIs: 'Unknown. No audited sold-price cohort is loaded for this postcode.',
      stabilised: 'Unknown. Works, voids and a let rent are not evidenced here.',
      breakup: 'Unknown. A break-up of flats or rooms is not evidenced.',
      maxBid: 'Unknown until you enter price, rent and costs in underwriting. A guide or asking price is not a bid.',
      sample: ''
    };
    if (typeof LO === 'undefined' || !LO || !pc) return out;
    let sector = '';
    try { sector = typeof secOf === 'function' ? secOf(pc) : ''; } catch (e) { sector = ''; }
    const district = String(pc).toUpperCase().split(' ')[0];
    const g = (sector && LO.sectors && LO.sectors[sector]) || (LO.districts && LO.districts[district]) || null;
    if (!g || !g.classes) {
      out.asIs = 'Unknown. No Local OMV cohort for ' + (sector || district || 'this postcode') + '.';
      return out;
    }
    const x = g.classes.flat2 || g.classes.house2 || null;
    const where = sector && LO.sectors && LO.sectors[sector] ? sector : district;
    if (!x) {
      out.asIs = 'Unknown. No flat or house cohort for ' + where + '.';
      return out;
    }
    const thin = !!x.sparse || (x.n != null && x.n < 10);
    const iqr = (x.p25 != null && x.p75 != null) ? (money(x.p25) + ' to ' + money(x.p75)) : 'Unknown';
    if (x.omv == null || x.displayable === false) {
      out.asIs = 'Withheld for ' + where + '. Sample n=' + (x.n == null ? 'Unknown' : x.n) + ' of ' + (x.n_raw == null ? 'Unknown' : x.n_raw) + (thin ? ' (thin sample).' : '.') + ' Middle 50% ' + iqr + '.';
    } else {
      out.asIs = where + ' as-is sold benchmark ' + money(x.omv) + ' (' + (x.label || 'recorded sales') + '). n=' + x.n + ' retained of ' + (x.n_raw == null ? x.n : x.n_raw) + (thin ? ', thin sample.' : '.') + ' Middle 50% (IQR) ' + iqr + '. Historical transactions, not a surveyor’s value.';
    }
    out.sample = 'Outlier rule: ' + (x.outlier_method || 'see Local OMV') + '. Geography is the postcode sector or district named above, not a street comp.';
    return out;
  }

  function row(kind, text) {
    return '<p><span class="lc-k">' + kind + '</span> ' + text + '</p>';
  }

  function lcDealCard(x) {
    x = x || {};
    const p = x.prop || null;
    const lot = x.lot || null;
    const owner = x.owner || null;
    const listing = x.listing || null;
    const band = x.band || (p ? lcBandForProp(p) : (lot && typeof sellerOf === 'function' ? lcBandFromSeller(sellerOf(lot)) : 'U'));
    const titles = {
      A: 'A · Verified live insolvency',
      B: 'B · Lender / receiver sale of this property',
      C: 'C · Watchlist. Not a forced sale and not a probability of default',
      D: 'D · Ordinary sale or insufficient evidence',
      U: 'Unknown. Not checked'
    };
    const sellerText = (p && p.seller_type) || (lot && lot.seller_type) || (owner && owner.A && owner.A.level === 'd' ? 'office-holder' : '');
    const route = x.route || lcRoute(band, sellerText || (listing ? 'agent' : ''));
    const pc = (p && p.postcode) || (lot && lot.postcode) || (listing && listing.postcode) || (x.site && (x.site.pcShow || x.site.pc)) || '';
    const worth = lcWorth(pc);
    const homes = p && Number.isInteger(p.site_homes) ? p.site_homes : (listing && Number.isInteger(listing.homes) ? listing.homes : null);
    const address = (p && p.address) || (lot && lot.address) || (listing && listing.address) || (x.site && x.site.addr) || (owner && owner.name) || 'Unknown';
    let what = esc(address);
    if (homes != null) what += '. <b>' + homes + '</b> existing home' + (homes === 1 ? '' : 's') + ' offered together at one site.';
    else if (owner && owner.titles != null) what += '. ' + (typeof fmtN === 'function' ? fmtN(owner.titles) : owner.titles) + ' company titles on file. That is not homes at one site.';
    else what += '. Home count at one site: Unknown.';
    if (p && p.site_evidence) what += ' ' + esc(p.site_evidence);
    else if (listing && listing.scope) what += ' ' + esc(listing.scope);

    let why = 'Unknown.';
    if (band === 'A' && owner && owner.A) why = esc(owner.A.ongoing.map(function (q) { return q.name + (q.start ? ' since ' + q.start.date : ''); }).join('; ') || owner.A.why || 'Live insolvency on the company record.');
    else if (band === 'C' && owner && owner.A) why = esc((owner.A.S || []).map(function (s) { return s.t; }).join('; ') || 'Watchlist signals on Companies House. The owner still controls the property.');
    else if (band === 'C' && x.site && x.site.pre) why = esc('Watchlist rank ' + x.site.pre.score + ' (in-sample ranking, not a probability of default): ' + (x.site.pre.signals || ''));
    else if (lot && typeof sellerOf === 'function') why = esc(sellerOf(lot).why || sellerOf(lot).label);
    else if (p && p.seller_type) why = esc(String(p.seller_type));
    else if (listing) why = 'Ordinary advertised sale unless a listing states a receiver or insolvency office-holder. ' + esc(listing.distress_evidence || listing.notes || 'No distress evidence on the listing.');
    else if (owner && owner.A && owner.A.why) why = esc(owner.A.why);

    const when = (p && p.checked_at) || (listing && listing.checked_at) || (lot && lot.seen) || (owner && owner.A && owner.A.ongoing[0] && owner.A.ongoing[0].start && owner.A.ongoing[0].start.date) || '';
    const sourceName = (p && (p.auctioneer || p.source_id)) || (listing && (listing.source || listing.agent)) || (lot && lot.auctioneer) || (band === 'A' || band === 'C' ? 'Companies House' : 'Unknown');
    const sourceUrl = (p && p.url) || (listing && listing.url) || (lot && lot.url) || (owner && owner.company_no && typeof CH === 'function' ? CH(owner.company_no) : '');
    let contact = 'Unknown';
    const c = (p && p.contact) || null;
    if (c && (c.name || c.email || c.phone)) {
      contact = esc(c.name || 'Listed contact') + (c.phone ? ' · ' + esc(c.phone) : '') + (c.email ? ' · ' + esc(c.email) : '');
    } else if (listing && listing.agent) contact = esc(listing.agent) + ' (agent on the listing)';
    else if (owner && owner.company_no && typeof CH === 'function') contact = 'Named on <a href="' + CH(owner.company_no) + '/officers" target="_blank" rel="noopener">Companies House officers</a>. Home addresses are not copied here.';

    const guide = (p && (p.guide || p.asking_price_gbp)) || (lot && lot.guide) || (listing && listing.price_text) || '';
    const next = {
      A: 'Read the insolvency filing, confirm the office-holder still acts, and ask which titles at this site they can sell.',
      B: 'Download the legal pack, confirm the seller wording, tenancies and title, then bid or offer the auctioneer.',
      C: 'Treat this as a watchlist. Write to the directors only after you confirm the charges are still outstanding. Do not price it as a forced sale.',
      D: 'Confirm it is one site of existing homes. Do not describe it as distressed.',
      U: 'Check the listing or Companies House before giving this a band.'
    }[band] || 'Check the source before acting.';

    const ons = 'ONS private rents on this site are local-authority (or Lothian BRMA) averages, not district or street comps. LHA is a benefit cap, not bankable rent, and is not in the lead score. Demand for temporary accommodation or asylum dispersal is not a lease guarantee.';

    return '<section class="lc-deal"><h3>' + titles[band] + '</h3>' +
      '<h4>What is it?</h4>' + row('Fact', what) +
      '<h4>Why might the seller need to sell?</h4>' + row(band === 'C' ? 'Estimate' : (band === 'U' ? 'Unknown' : 'Fact'), why) +
      '<h4>Evidence</h4>' + row('Fact', esc(sourceName) + (when ? ', ' + esc(String(when).slice(0, 10)) : ', date Unknown') + (sourceUrl ? ' · <a href="' + esc(sourceUrl) + '" target="_blank" rel="noopener">open source</a>' : '')) +
      '<h4>What might it be worth?</h4>' +
      row('Estimate', '<b>As-is.</b> ' + esc(worth.asIs) + (worth.sample ? ' ' + esc(worth.sample) : '')) +
      row('Unknown', '<b>Stabilised.</b> ' + esc(worth.stabilised)) +
      row('Unknown', '<b>Break-up.</b> ' + esc(worth.breakup)) +
      row('Unknown', '<b>Maximum bid.</b> ' + esc(worth.maxBid)) +
      row('Fact', esc(ons) + ' An exit yield, including 6–6.5%, is an assumption if you type one into underwriting. It is not evidence from these sales.') +
      '<h4>What could we pay?</h4>' + row('Unknown', 'Unknown until price, rent and costs are entered.' + (guide ? ' Listed guide or asking (not a bid): ' + esc(String(guide)) + '.' : '')) +
      '<h4>Who can sell?</h4>' + row('Fact', 'Sale route: <b>' + esc(route) + '</b>. Contact: ' + contact + '.') +
      '<h4>What to check next</h4>' + row('Fact', esc(next)) +
      '</section>';
  }

  function lauritoRescore(rows) {
    if (!rows || !rows.length) return;
    for (const r of rows) {
      if ((r.nb == null) && typeof DEM !== 'undefined' && DEM && DEM.building_counts && DEM.building_counts[r.district]) {
        r.nb = DEM.building_counts[r.district].buildings;
      }
    }
    const keys = ['epc_efg', 'epc_subc', 'nb'];
    const ranks = {};
    for (const k of keys) {
      const vals = rows.map(function (r) { return +r[k] || 0; }).sort(function (a, b) { return a - b; });
      ranks[k] = function (v) {
        const x = +v || 0;
        let lo = 0;
        while (lo < vals.length && vals[lo] < x) lo++;
        let hi = lo;
        while (hi < vals.length && vals[hi] === x) hi++;
        return vals.length ? ((lo + hi) / 2) / vals.length : 0;
      };
    }
    for (const r of rows) {
      const parts = keys.map(function (k) { return ranks[k](r[k]); });
      r.score = Math.round(100 * parts.reduce(function (a, b) { return a + b; }, 0) / parts.length);
      r.score_basis = 'buildings, sub-C rentals, E-G rentals';
    }
  }

  const PIPE_KEY = 'lc_pipe_stages';

  function pipeMap() {
    try { return JSON.parse(localStorage.getItem(PIPE_KEY) || '{}'); } catch (e) { return {}; }
  }

  function lcApplyLocalStages() {
    const m = pipeMap();
    if (typeof D === 'undefined' || !D.owners) return;
    for (const o of D.owners) if (m[o.owner_key]) o.stage = m[o.owner_key];
  }

  async function lcSaveStage(o) {
    let remote = false;
    try {
      const r = await fetch(SUPA_URL + '/rest/v1/owners?owner_key=eq.' + encodeURIComponent(o.owner_key), {
        method: 'PATCH',
        headers: Object.assign({}, AUTHH(), { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ stage: o.stage, updated_at: new Date().toISOString() })
      });
      remote = r.ok;
    } catch (e) { remote = false; }
    const m = pipeMap();
    if (remote) delete m[o.owner_key];
    else m[o.owner_key] = o.stage;
    try { localStorage.setItem(PIPE_KEY, JSON.stringify(m)); } catch (e) {}
    const note = document.querySelector('#pipe_sync');
    if (note) note.textContent = remote
      ? 'Stage saved to the shared database.'
      : 'The database did not take this update. The stage is in this browser only. Export JSON to hand it on.';
  }

  function lcExportPipe() {
    lcApplyLocalStages();
    const local = pipeMap();
    const deals = (D.owners || []).filter(function (o) { return o.stage && o.stage !== 'identified'; }).map(function (o) {
      return {
        owner_key: o.owner_key,
        name: o.name,
        company_no: o.company_no || '',
        stage: o.stage,
        band: o.A && o.A.level === 'd' ? 'A' : o.A && o.A.level === 's' ? 'C' : 'Unknown',
        stored: local[o.owner_key] ? 'this browser' : 'loaded with the page'
      };
    });
    const blob = new Blob([JSON.stringify({
      exported: new Date().toISOString(),
      product: 'Laurito Capital distressed acquisition',
      note: 'Pipeline handover. Stages only. No new personal data. Not a valuation.',
      deals: deals
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'laurito-pipeline.json';
    a.click();
  }

  function lcImportPipe(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let data;
      try { data = JSON.parse(String(reader.result || '')); } catch (e) {
        const note = document.querySelector('#pipe_sync');
        if (note) note.textContent = 'That file is not pipeline JSON.';
        return;
      }
      const deals = Array.isArray(data) ? data : (data.deals || []);
      const m = pipeMap();
      let n = 0;
      for (const d of deals) {
        if (!d || !d.owner_key || !d.stage) continue;
        m[d.owner_key] = d.stage;
        const o = D.ownersByKey && D.ownersByKey[d.owner_key];
        if (o) o.stage = d.stage;
        n++;
      }
      try { localStorage.setItem(PIPE_KEY, JSON.stringify(m)); } catch (e) {}
      if (typeof renderPipeline === 'function') renderPipeline();
      const note = document.querySelector('#pipe_sync');
      if (note) note.textContent = 'Imported ' + n + ' stages into this browser. They are not written to the database until a stage change is accepted there.';
    };
    reader.readAsText(file);
  }

  function lcWirePipe() {
    const exp = document.querySelector('#pipe_export');
    const imp = document.querySelector('#pipe_import');
    if (exp) exp.onclick = function (e) { e.preventDefault(); lcExportPipe(); };
    if (imp) imp.onchange = function () { if (imp.files && imp.files[0]) lcImportPipe(imp.files[0]); };
  }

  function mountChrome() {
    if (document.querySelector('.lc-note')) return;
    const foot = document.createElement('footer');
    foot.className = 'lc-note';
    foot.innerHTML = '<b>Accuracy and licensing.</b> Screening uses public registers already in this project: Companies House, HM Land Registry company ownership and Price Paid, EPC open data, ONS private rents, VOA / DWP Local Housing Allowance, and checked auction or portal listings. Each figure is a fact, an estimate or unknown — a blank is Unknown, not healthy and not zero. Ownership and officer names come from those published sources; this screen does not add further personal data. ONS rents are local-authority figures (Lothian is a BRMA), not district comps. LHA is a benefit cap, not bankable rent. Temporary accommodation or asylum demand is not a lease guarantee. Red, amber and purple mark A, C and B only. Edinburgh is parked. Focus: Manchester, Cheltenham, Bristol, and 5–30 existing homes offered together at one site.';
    document.body.appendChild(foot);
  }

  function wire() {
    mountChrome();
    if (typeof renderAreas === 'function') {
      const prevAreas = renderAreas;
      renderAreas = function () {
        if (typeof D !== 'undefined' && D.subareas) lauritoRescore(D.subareas);
        return prevAreas();
      };
    }
    if (typeof districtRows === 'function') {
      const prevDistrict = districtRows;
      districtRows = function () {
        if (typeof D !== 'undefined' && D.subareas) lauritoRescore(D.subareas);
        return prevDistrict();
      };
    }
    if (typeof card === 'function') {
      const prevCard = card;
      card = function (o) {
        const html = prevCard(o);
        if (!o || !o.A) return html;
        const band = o.A.level === 'd' ? 'A' : o.A.level === 's' ? 'C' : (o.A.why ? 'D' : 'U');
        if (band !== 'A' && band !== 'C' && band !== 'D') return html;
        return html.replace('</article>', lcDealCard({ band: band, owner: o }) + '</article>');
      };
    }
    if (typeof lotCard === 'function') {
      const prevLot = lotCard;
      lotCard = function (l) {
        let html = prevLot(l);
        const band = typeof sellerOf === 'function' ? lcBandFromSeller(sellerOf(l)) : 'U';
        if (band !== 'B') {
          html = html.replace('border-left-color:#6a1b9a', 'border-left-color:#5b6472').replace(/#6a1b9a/g, '#5b6472');
        }
        const prop = typeof sfFind === 'function' ? sfFind(l) : null;
        return html.replace('</article>', lcDealCard({ band: band, lot: l, prop: prop }) + '</article>');
      };
    }
    if (typeof renderBest === 'function') {
      const prevBest = renderBest;
      renderBest = function () {
        prevBest();
        const t = document.querySelector('#tbest');
        const box = document.querySelector('#bestcard');
        if (!box) return;
        let host = document.querySelector('#lc_best_card');
        if (!host) {
          host = document.createElement('div');
          host.id = 'lc_best_card';
          box.appendChild(host);
        }
        const rows = window.LC_BEST || [];
        if (!rows.length) {
          host.innerHTML = '<p class="foot">No A or B leads in Manchester, Cheltenham or Bristol in this load. Open the A/B/C map or For sale now. An empty list is not evidence that nothing is for sale.</p>';
          return;
        }
        host.innerHTML = '<p class="foot">Select a row for the deal card. A and B are listed before C. The rank does not use titles owned or LHA.</p>';
        if (!t) return;
        t.querySelectorAll('tbody tr').forEach(function (tr) {
          tr.addEventListener('click', function () {
            const r = rows[+tr.dataset.i];
            if (!r) return;
            const band = r.kind === 'Lot' ? lcBandFromSeller(sellerOf(r.l)) : (r.level === 'd' ? 'A' : 'C');
            const prop = r.l && typeof sfFind === 'function' ? sfFind(r.l) : null;
            host.innerHTML = lcDealCard({ band: band, lot: r.l, owner: r.o, prop: prop });
          });
        });
      };
    }
    if (typeof dsCompute === 'function') {
      const prevDs = dsCompute;
      dsCompute = async function (city) {
        const out = await prevDs(city);
        /* LHA is not an attractiveness input. Zero any legacy rent component if a cached score still has one. */
        if (out) for (const k of Object.keys(out)) {
          const v = out[k];
          if (v && v.p && v.p.rent) {
            v.score = Math.max(0, (v.score || 0) - v.p.rent);
            v.p.rent = 0;
          }
        }
        return out;
      };
    }
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : this;
  root.lcDealCard = lcDealCard;
  root.lcBandForProp = lcBandForProp;
  root.lcBandFromSeller = lcBandFromSeller;
  root.lauritoRescore = lauritoRescore;
  root.lcApplyLocalStages = lcApplyLocalStages;
  root.lcSaveStage = lcSaveStage;
  root.lcWirePipe = lcWirePipe;
  root.lcWorth = lcWorth;

  if (typeof document !== 'undefined') wire();
})();
