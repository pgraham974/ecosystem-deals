/* Auctions: public JSON snapshots only. No Supabase, credentials or distress inference. */
(function () {
  'use strict';
  const TOWNS = ['Manchester', 'Glasgow', 'Edinburgh', 'Bristol', 'Cheltenham'];
  const TYPES = ['All', 'Blocks', 'Houses', 'Flats', 'HMO', 'Portfolios', 'Mixed-use', 'Development'];
  const STATUSES = ['upcoming', 'sold', 'unsold', 'withdrawn'];
  const MAX_AGE = 48 * 60 * 60 * 1000;
  const state = { town: '', type: 'All', status: 'upcoming', sort: 'date', lots: null, coverage: null, error: '', coverageError: '', loading: false };
  const escape = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function url(v) { try { const u = new URL(v); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (_) { return ''; } }
  function link(u, label) { const safe = url(u); return safe ? '<a href="'+escape(safe)+'" target="_blank" rel="noopener noreferrer">'+escape(label)+'</a>' : '<span>'+escape(label)+' (link unavailable)</span>'; }
  function town(v) { return /^(city of bristol|bristol, city of)$/i.test(v || '') ? 'Bristol' : /^(city of edinburgh|edinburgh, city of)$/i.test(v || '') ? 'Edinburgh' : TOWNS.find(t => t.toLowerCase() === String(v || '').trim().toLowerCase()) || ''; }
  function type(v) { const s = String(v || '').toLowerCase().replace(/[_ ]/g, '-'); return ({block:'Blocks',blocks:'Blocks',house:'Houses',houses:'Houses',flat:'Flats',flats:'Flats',hmo:'HMO',portfolio:'Portfolios',portfolios:'Portfolios','mixed-use':'Mixed-use',mixed:'Mixed-use',development:'Development','development-site':'Development'})[s] || ''; }
  function stamp(v) { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : null; }
  function date(v, time) { const n = stamp(v); return n === null ? 'Not recorded' : new Date(n).toLocaleString('en-GB', { timeZone: 'Europe/London', day:'numeric', month:'short', year:'numeric', ...(time ? {hour:'2-digit',minute:'2-digit'} : {}) }); }
  function money(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? new Intl.NumberFormat('en-GB', {style:'currency',currency:'GBP',maximumFractionDigits:0}).format(v) : null; }
  function evidence(l) { if (typeof l.grade_evidence === 'string') return l.grade_evidence.trim(); if (l.grade_evidence && typeof l.grade_evidence === 'object') return Object.entries(l.grade_evidence).filter(([,v]) => v != null && v !== '').map(([k,v]) => k+': '+(typeof v === 'object' ? JSON.stringify(v) : v)).join('; '); return ''; }
  // Bands are explicitly verified upstream. Never classify by title, price, auction status or seller keywords here.
  function grade(l) { return /^[ABC]$/.test(l.grade || '') && evidence(l) && (url(l.source_url) || (Array.isArray(l.sources) && l.sources.some(s => url(s.url)))) ? l.grade : ''; }
  function old(v) { const n = stamp(v); return n === null || Date.now() - n > MAX_AGE; }
  function stale(l) { return l.stale === true || old(l.scraped_at); }
  function filtered(lots, s) {
    const out = lots.filter(l => town(l.town) && (!s.town || town(l.town) === s.town) && (s.type === 'All' || type(l.residential_subtype || l.property_type || l.lot_type) === s.type) && (s.status === 'all' || l.status === s.status));
    const number = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return out.sort((a,b) => {
      let d = 0;
      if (s.sort === 'price-asc') d = number(a.guide_price, Infinity) - number(b.guide_price, Infinity);
      else if (s.sort === 'price-desc') d = number(b.guide_price, -Infinity) - number(a.guide_price, -Infinity);
      else if (s.sort === 'sold-desc') d = number(b.sold_price, -Infinity) - number(a.sold_price, -Infinity);
      else if (s.sort === 'updated') d = (stamp(b.scraped_at) || 0) - (stamp(a.scraped_at) || 0);
      else if (s.sort === 'grade') { const rank = g => ({A:0,B:1,C:2})[g] ?? 3; d = rank(grade(a)) - rank(grade(b)); }
      else { const aDate=stamp(a.auction_date), bDate=stamp(b.auction_date); d = aDate === null ? (bDate === null ? 0 : 1) : bDate === null ? -1 : s.status === 'sold' ? bDate-aDate : aDate-bDate; }
      return (Number.isFinite(d) && d !== 0 ? d : d === Infinity ? 1 : d === -Infinity ? -1 : 0) || String(a.address || a.title || '').localeCompare(String(b.address || b.title || ''));
    });
  }
  function card(l) {
    const titled = String(l.title || '').trim();
    const genericTitle = !titled || /^(?:\d+\s*bedroom\s+)?(flat|house|studio|maisonette|hmo|apartment)s?$/i.test(titled) || titled === String(l.lot_type || '');
    const heading = genericTitle ? (l.address || titled || 'Untitled lot') : titled;
    const g = grade(l), shared = window.lcAssetGrade;
    const color = shared ? shared.color(g) : ({A:'#c62828',B:'#6a1b9a',C:'#b26a00','':'#5b6472'})[g];
    const label = shared ? shared.label(g) : ({A:'A · Live insolvency',B:'B · Lender or receiver sale',C:'C · Watchlist','':'Ungraded'})[g];
    const passed = l.status === 'upcoming' && stamp(l.auction_date) !== null && String(l.auction_date).slice(0,10) < new Date().toISOString().slice(0,10);
    const extra = Array.isArray(l.sources) ? l.sources.filter(s => s && url(s.url)) : [];
    const rawGuide = String(l.guide_price_text || '');
    const amount = rawGuide.match(/£\s*([\d,]+(?:\.\d+)?)/);
    const zeroPlaceholder = amount && Number(amount[1].replace(/,/g,'')) === 0;
    const publishedGuideText = !zeroPlaceholder && (/£\s*\d/.test(rawGuide) || /\bPOA\b|price on application/i.test(rawGuide)) ? rawGuide : '';
    const guide = (l.guide_price > 0 ? money(l.guide_price) : null) || publishedGuideText || 'Guide not published';
    return '<article class="aq-lot"><div class="aq-lot-top"><span class="aq-eyebrow">'+escape(town(l.town))+' · '+escape(type(l.residential_subtype || l.property_type || l.lot_type) || 'Type not recorded')+'</span><span class="aq-status">'+escape(l.status)+'</span></div><h2>'+escape(heading)+'</h2>'+(genericTitle ? '' : '<p class="aq-address">'+escape(l.address || 'Address not recorded')+'</p>')+(l.lot_type && l.lot_type !== heading ? '<p class="aq-muted">'+escape(l.lot_type)+'</p>' : '')+'<div class="aq-prices"><div><small>Guide price, not value</small><strong>'+escape(guide)+'</strong>'+(money(l.guide_price) && l.guide_price_text ? '<span>'+escape(l.guide_price_text)+'</span>' : '')+'</div>'+(money(l.opening_bid) ? '<div><small>Opening bid, not guide</small><strong>'+escape(money(l.opening_bid))+'</strong></div>' : '')+(l.status === 'sold' ? '<div><small>Reported sold price</small><strong>'+escape(money(l.sold_price) || 'Not disclosed')+'</strong></div>' : '')+'<div><small>Auction date</small><strong class="aq-date">'+escape(date(l.auction_date, false))+'</strong></div></div><div class="aq-grade" style="--aq-grade:'+color+'">'+escape(label)+'</div>'+(g ? '<details class="aq-evidence"><summary>Grade evidence</summary><p>'+escape(evidence(l))+'</p><p>Classification supplied by the checked feed. Recheck the filing, owner-to-asset link and current sale instruction before acting.</p></details>' : '<p class="aq-muted">No verified grade loaded. Auction entry alone is not distress evidence.</p>')+(stale(l) || passed ? '<p class="aq-caution">'+(passed ? 'Auction date has passed. Outcome unconfirmed; upcoming is the last reported status. ' : '')+(stale(l) ? 'Stale or undated source check. ' : '')+'Recheck the auctioneer.</p>' : '')+'<div class="aq-source">'+link(l.source_url, l.source || 'Auctioneer source')+'<span>Checked '+escape(date(l.scraped_at, true))+' London time</span></div>'+(extra.length ? '<details class="aq-evidence"><summary>All sources ('+extra.length+')</summary><ul>'+extra.map(s => '<li>'+link(s.url,s.name || 'Source')+'</li>').join('')+'</ul></details>' : '')+'</article>';
  }
  function coverage() {
    const c = state.coverage;
    if (!c) return '<div class="aq-coverage aq-muted">Coverage unavailable. '+escape(state.coverageError || 'Loading source checks...')+' Lot results are not proof of complete market coverage.</div>';
    const sources = c.sources, counts = {};
    for (const s of sources) counts[s.status] = (counts[s.status] || 0)+1;
    const excludedKnown = sources.every(s => typeof s.commercial_excluded === 'number');
    const excluded = sources.reduce((n,s) => n+(typeof s.commercial_excluded === 'number' ? s.commercial_excluded : 0),0);
    const towns = TOWNS.map(t => { const n = c.counts_by_town && c.counts_by_town[t]; return t+' '+(typeof n === 'number' ? n : '—'); }).join(' · ');
    return '<details class="aq-coverage"><summary><b>Source coverage</b><span>'+towns+' · '+['live','partial','failed','skipped'].map(k => (counts[k] || 0)+' '+k).join(' · ')+' · '+excluded+' commercial excluded'+(excludedKnown ? '' : ' (known counts only)')+'</span></summary><p class="aq-muted">Checked '+escape(date(c.updated_at,true))+' London time. '+(old(c.updated_at) ? 'Coverage snapshot is stale or undated. ' : '')+'Live means the source was accessible when checked, not that every lot is available. Failed and skipped sources are coverage gaps.</p><div class="aq-town-counts">'+TOWNS.map(t => {const n=c.counts_by_town && c.counts_by_town[t];return '<span>'+escape(t)+': <b>'+(typeof n === 'number' ? n : 'Not reported')+'</b></span>';}).join('')+'</div><div class="aq-source-list">'+sources.map(s => '<div class="aq-source-row"><div><b>'+link(s.url,s.name || s.id || 'Source')+'</b><span>'+escape(s.reason || 'No additional note supplied')+'</span></div><div><b>'+escape(s.status)+'</b><span>'+(typeof s.lot_count === 'number' ? s.lot_count : 'Unknown')+' lots · '+(typeof s.commercial_excluded === 'number' ? s.commercial_excluded : 'Unknown')+' commercial excluded</span><span>'+escape(date(s.checked_at,true))+'</span></div></div>').join('')+'</div></details>';
  }
  function render() {
    const root = document.getElementById('auctions_body'); if (!root) return;
    const options = (items,current) => items.map(([v,l]) => '<option value="'+escape(v)+'"'+(v === current ? ' selected' : '')+'>'+escape(l)+'</option>').join('');
    const list = state.lots ? filtered(state.lots.lots, state) : [];
    const total = state.lots ? state.lots.lots.filter(l => town(l.town)).length : 0;
    root.innerHTML = '<div class="aq-heading"><div><p class="aq-eyebrow">Residential auction monitor</p><h1>Auctions</h1><p>Five towns. One source-led view.</p></div><div class="aq-refresh"><span>Updated '+escape(date(state.lots && state.lots.updated_at,true))+' London time</span><button type="button" data-aq-action="refresh"'+(state.loading ? ' disabled' : '')+'>'+(state.loading ? 'Refreshing...' : 'Refresh snapshot')+'</button></div></div><p class="aq-intro">Manchester, Glasgow, Edinburgh, Bristol and Cheltenham. Residential and residential-led mixed-use lots. Pure commercial stock is excluded by the feed. Guides are not valuations; reported sold prices are not necessarily completed transactions.</p>'+coverage()+'<div class="aq-toolbar"><div class="aq-tabs" aria-label="Lot status">'+[['upcoming','Upcoming'],['sold','Sold']].map(([v,l]) => '<button type="button" data-aq-status="'+v+'" aria-pressed="'+(state.status === v)+'">'+l+'</button>').join('')+'</div><label>Other statuses<select data-aq-filter="status" aria-label="Other lot statuses">'+options([['','Choose status'],['all','All statuses'],['unsold','Unsold'],['withdrawn','Withdrawn']],['all','unsold','withdrawn'].includes(state.status) ? state.status : '')+'</select></label><label>Town<select data-aq-filter="town">'+options([['','All five towns'],...TOWNS.map(t => [t,t])],state.town)+'</select></label><label>Property type<select data-aq-filter="type">'+options(TYPES.map(t => [t,t]),state.type)+'</select></label><label>Sort<select data-aq-filter="sort">'+options([['date',state.status === 'sold' ? 'Auction date, newest' : 'Auction date, soonest'],['price-asc','Guide, low to high'],['price-desc','Guide, high to low'],['sold-desc','Sold price, high to low'],['grade','Grade, A first'],['updated','Last checked, newest']],state.sort)+'</select></label></div><details class="aq-rules"><summary>What A, B, C and Ungraded mean</summary><p><b>A:</b> verified live insolvency of the owner linked to this asset. <b>B:</b> verified receiver or lender-instructed sale of this asset. <b>C:</b> verified owner watchlist evidence. <b>Ungraded:</b> no supported classification loaded, not proof of financial health. An auction, low guide or unsold result alone never earns a grade.</p></details><div role="status" aria-live="polite" class="aq-result-summary">'+(state.loading && !state.lots ? 'Loading auction snapshots...' : list.length+' matching lots · '+total+' loaded across the five towns · '+escape(state.status === 'all' ? 'all statuses' : state.status))+'</div>'+(state.error ? '<div class="aq-notice" role="alert"><b>Auction feed unavailable</b><p>'+escape(state.error)+(state.lots ? ' Last successfully loaded data remains below.' : ' No lots have been invented. Retry or check the data files.')+'</p></div>' : '')+(state.lots && old(state.lots.updated_at) ? '<div class="aq-notice"><b>Stale or undated snapshot</b><p>The feed is over 48 hours old or has no valid timestamp. All statuses are last reported, not live availability.</p></div>' : '')+(list.length ? '<div class="aq-lots">'+list.map(card).join('')+'</div>' : state.lots ? '<div class="aq-empty"><h2>No matching lots loaded</h2><p>'+(state.town && !state.lots.lots.some(l => town(l.town) === state.town) ? 'No records are loaded for '+escape(state.town)+'. ' : '')+'This is a coverage result, not proof that no properties exist or are for sale. Review source gaps above or widen your filters.</p><button type="button" data-aq-action="reset">Clear filters and show all statuses</button></div>' : '');
  }
  async function json(file) { const controller = new AbortController(), timer = setTimeout(() => controller.abort(),15000); try { const r=await fetch(file+'?v='+Date.now(),{cache:'no-store',signal:controller.signal}); if(!r.ok) throw Error(file+' returned HTTP '+r.status); return await r.json(); } finally { clearTimeout(timer); } }
  async function load() {
    if (state.loading) return; state.loading=true;state.error='';state.coverageError='';render();
    await Promise.all([
      json('data/auctions/lots.json').then(j => { if(j.schema_version !== 1 || !Array.isArray(j.lots) || j.lots.some(l => !l || typeof l !== 'object' || !STATUSES.includes(l.status))) throw Error('Unsupported or malformed auction feed; expected schema_version 1 and explicit lot statuses.'); state.lots=j; }).catch(e => {state.error=e.name === 'AbortError' ? 'Auction feed timed out.' : e.message;}),
      json('data/auctions/coverage.json').then(j => {if(!Array.isArray(j.sources) || j.sources.some(s => !s || !['live','partial','failed','skipped'].includes(s.status))) throw Error('Malformed coverage feed.');state.coverage=j;}).catch(e => {state.coverageError=e.name === 'AbortError' ? 'Source coverage timed out.' : e.message;state.coverage=null;})
    ]); state.loading=false;render();
  }
  function start() { render(); if(!state.lots && !state.loading) load(); }
  const api = {start, refresh:load, town, type, grade, filtered, stale}; window.lcAuctions=api;
  function boot() {
    const root=document.getElementById('auctions_body');if(!root)return;
    root.addEventListener('click', e => {const b=e.target.closest('button');if(!b)return;if(b.dataset.aqStatus){state.status=b.dataset.aqStatus;render();}if(b.dataset.aqAction === 'refresh')load();if(b.dataset.aqAction === 'reset'){Object.assign(state,{town:'',type:'All',status:'all',sort:'date'});render();}});
    root.addEventListener('change',e => {const key=e.target.dataset.aqFilter;if(key && e.target.value !== ''){state[key]=e.target.value;render();}else if(key === 'town'){state.town='';render();}});
    // Laurito's shared chrome contains old parked copy. Correct only that exact dated copy, not other modules.
    const footer=document.querySelector('footer.lc-note');if(footer)footer.innerHTML=footer.innerHTML.replace('Edinburgh is parked.','Edinburgh is included where source data is loaded; missing data is not zero.').replace('Focus: Manchester, Cheltenham, Bristol, and','Focus: Manchester, Cheltenham, Bristol and Edinburgh, and');
    if(location.hash === '#auctions'){if(typeof viewMode === 'function')viewMode('auctions');else {document.getElementById('auctions_view').classList.remove('hidden');start();}}
    window.addEventListener('hashchange',()=>{if(location.hash === '#auctions' && typeof viewMode === 'function')viewMode('auctions');});
    render();
  }
  if(document.readyState === 'loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
